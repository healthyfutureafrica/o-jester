"""Payment gateways. Each exposes create_checkout() and verify() — verify() asks the provider
for the authoritative status; redirects and webhooks are never trusted on their own."""

from __future__ import annotations

import base64
import os
import time
from dataclasses import dataclass
from urllib.parse import quote, urlsplit

import requests
from flask import has_request_context, request

from ..config import settings
from ..db import Payment, User
from ..util import loads

TIMEOUT = 30


@dataclass
class VerifyResult:
    status: str  # SUCCEEDED | FAILED | PENDING | CANCELLED
    provider_ref: str | None = None
    paid_amount: float | None = None
    paid_currency: str | None = None
    reason: str | None = None


def _known_hosts() -> set[str]:
    hosts = {"localhost", "127.0.0.1"}
    app_host = urlsplit(settings.app_url).hostname or ""
    bare = app_host.removeprefix("www.")
    hosts |= {app_host, bare, f"www.{bare}"}
    if render_host := os.environ.get("RENDER_EXTERNAL_HOSTNAME"):
        hosts.add(render_host)
    return {h for h in hosts if h}


def _base_url() -> str:
    """Address the customer is using (custom domain or the host's default one) if it is one of ours, else APP_URL.

    The Host header is client-controlled, so unknown hosts never end up in payment redirect URLs.
    """
    if has_request_context() and (request.host.split(":")[0] in _known_hosts()):
        return request.host_url.rstrip("/")
    return settings.app_url


def _return_url(p: Payment) -> str:
    return f"{_base_url()}/payment/return?reference={quote(p.reference)}"


class Flutterwave:
    """Flutterwave Standard: MTN MoMo / Orange Money in XAF ("mobilemoneyfranco") and cards."""

    id = "FLUTTERWAVE"
    base = "https://api.flutterwave.com/v3"

    def _call(self, method: str, path: str, **kwargs) -> dict:
        res = requests.request(method, self.base + path, headers={"Authorization": f"Bearer {settings.flutterwave_secret_key}"}, timeout=TIMEOUT, **kwargs)
        body = res.json() if res.content else {}
        if not res.ok or body.get("status") != "success":
            raise RuntimeError(f"Flutterwave {path}: {body.get('message', res.status_code)}")
        return body["data"]

    def create_checkout(self, p: Payment, user: User, method: str, phone: str | None, plan_name: str) -> tuple[str, str | None]:
        data = self._call(
            "POST",
            "/payments",
            json={
                "tx_ref": p.reference,
                "amount": p.amount_xaf,
                "currency": "XAF",
                "redirect_url": _return_url(p),
                "payment_options": "mobilemoneyfranco" if method == "MOBILE_MONEY" else "card",
                "customer": {"email": user.email, "name": user.name, "phonenumber": phone or user.phone},
                "customizations": {"title": "O-Jester", "description": f"O-Jester {plan_name} — 30 days", "logo": f"{_base_url()}/static/logo.svg"},
                "meta": {"user_id": user.id, "plan": p.plan},
            },
        )
        return data["link"], None

    def verify(self, p: Payment, hint: dict | None = None) -> VerifyResult:
        try:
            data = self._call("GET", f"/transactions/verify_by_reference?tx_ref={quote(p.reference)}")
        except Exception as exc:  # noqa: BLE001 — not found until the customer starts paying
            return VerifyResult("PENDING", reason=str(exc))
        if data.get("tx_ref") != p.reference:
            return VerifyResult("FAILED", reason="Reference mismatch")
        status = {"successful": "SUCCEEDED", "failed": "FAILED"}.get(data.get("status"), "PENDING")
        return VerifyResult(status, str(data.get("id")), float(data.get("amount") or 0), data.get("currency"))


class PayPal:
    """PayPal Orders v2. PayPal can't settle XAF, so plans are charged in EUR (fixed CFA peg) or USD."""

    id = "PAYPAL"
    _token: tuple[str, float] | None = None

    @property
    def base(self) -> str:
        return "https://api-m.paypal.com" if settings.paypal_mode == "live" else "https://api-m.sandbox.paypal.com"

    def _access_token(self) -> str:
        if PayPal._token and PayPal._token[1] > time.time() + 60:
            return PayPal._token[0]
        auth = base64.b64encode(f"{settings.paypal_client_id}:{settings.paypal_client_secret}".encode()).decode()
        res = requests.post(f"{self.base}/v1/oauth2/token", data={"grant_type": "client_credentials"}, headers={"Authorization": f"Basic {auth}"}, timeout=TIMEOUT)
        res.raise_for_status()
        body = res.json()
        PayPal._token = (body["access_token"], time.time() + body["expires_in"])
        return body["access_token"]

    def call(self, method: str, path: str, idempotency_key: str | None = None, **kwargs) -> dict:
        headers = {"Authorization": f"Bearer {self._access_token()}", "Content-Type": "application/json"}
        if idempotency_key:
            headers["PayPal-Request-Id"] = idempotency_key
        res = requests.request(method, self.base + path, headers=headers, timeout=TIMEOUT, **kwargs)
        body = res.json() if res.content else {}
        if not res.ok:
            raise RuntimeError(f"PayPal {path}: {body.get('name', res.status_code)} {body.get('message', '')}")
        return body

    def create_checkout(self, p: Payment, user: User, method: str, phone: str | None, plan_name: str) -> tuple[str, str | None]:
        ret = _return_url(p)
        order = self.call(
            "POST",
            "/v2/checkout/orders",
            idempotency_key=p.reference,
            json={
                "intent": "CAPTURE",
                "purchase_units": [
                    {"reference_id": p.reference, "custom_id": p.reference, "description": f"O-Jester {plan_name} — 30 days",
                     "amount": {"currency_code": p.charge_currency, "value": p.charge_amount}}
                ],
                "payment_source": {"paypal": {"experience_context": {"brand_name": "O-Jester", "user_action": "PAY_NOW", "shipping_preference": "NO_SHIPPING",
                                                                     "return_url": ret, "cancel_url": f"{ret}&cancelled=1"}}},
            },
        )  # fmt: skip
        link = next((l["href"] for l in order.get("links", []) if l["rel"] in ("payer-action", "approve")), None)
        if not link:
            raise RuntimeError("PayPal did not return an approval link")
        return link, order["id"]

    @staticmethod
    def _capture_result(order: dict) -> VerifyResult:
        captures = ((order.get("purchase_units") or [{}])[0].get("payments") or {}).get("captures") or []
        if not captures:
            return VerifyResult("PENDING", order.get("id"))
        cap = captures[0]
        if cap["status"] == "COMPLETED":
            return VerifyResult("SUCCEEDED", order["id"], float(cap["amount"]["value"]), cap["amount"]["currency_code"])
        return VerifyResult("PENDING" if cap["status"] == "PENDING" else "FAILED", order["id"], reason=cap["status"])

    def verify(self, p: Payment, hint: dict | None = None) -> VerifyResult:
        if not p.provider_ref:
            return VerifyResult("FAILED", reason="Missing PayPal order id")
        order = self.call("GET", f"/v2/checkout/orders/{p.provider_ref}")
        if order["status"] == "COMPLETED":
            return self._capture_result(order)
        if order["status"] == "APPROVED":
            return self._capture_result(self.call("POST", f"/v2/checkout/orders/{order['id']}/capture", idempotency_key=f"{p.reference}-capture"))
        if order["status"] == "VOIDED":
            return VerifyResult("FAILED", order["id"], reason="Order voided")
        if hint and hint.get("cancelled"):
            return VerifyResult("CANCELLED", order["id"])
        return VerifyResult("PENDING", order["id"])

    def verify_webhook(self, headers: dict, event: dict) -> bool:
        if not settings.paypal_webhook_id:
            return False
        body = self.call(
            "POST",
            "/v1/notifications/verify-webhook-signature",
            json={
                "auth_algo": headers.get("Paypal-Auth-Algo"), "cert_url": headers.get("Paypal-Cert-Url"),
                "transmission_id": headers.get("Paypal-Transmission-Id"), "transmission_sig": headers.get("Paypal-Transmission-Sig"),
                "transmission_time": headers.get("Paypal-Transmission-Time"), "webhook_id": settings.paypal_webhook_id, "webhook_event": event,
            },
        )  # fmt: skip
        return body.get("verification_status") == "SUCCESS"


class Sandbox:
    """Local test gateway (PAYMENTS_SANDBOX=true): an in-app mock checkout page; no money moves."""

    id = "SANDBOX"

    def create_checkout(self, p: Payment, user: User, method: str, phone: str | None, plan_name: str) -> tuple[str, str | None]:
        return f"{_base_url()}/payment/sandbox?reference={quote(p.reference)}", None

    def verify(self, p: Payment, hint: dict | None = None) -> VerifyResult:
        outcome = (loads(p.meta) or {}).get("sandbox_outcome")
        if outcome == "success":
            return VerifyResult("SUCCEEDED", f"SBX-{p.reference}", float(p.charge_amount), p.charge_currency)
        if outcome == "fail":
            return VerifyResult("FAILED", reason="Declined in sandbox")
        return VerifyResult("PENDING")


flutterwave, paypal, sandbox = Flutterwave(), PayPal(), Sandbox()
GATEWAYS = {g.id: g for g in (flutterwave, paypal, sandbox)}
