"""Checkout, verification and idempotent fulfilment of subscription payments."""

from __future__ import annotations

import logging

from sqlalchemy import select, update

from ..config import settings
from ..db import Payment, User, db
from ..plans import PLANS
from ..subscriptions import activate_plan
from ..util import dumps, loads, payment_reference, utc_now
from .gateways import GATEWAYS, flutterwave, paypal, sandbox

log = logging.getLogger("ojester.payments")

#: The CFA franc is pegged to the euro: 1 EUR = 655.957 XAF.
XAF_PER_EUR = 655.957
METHODS = ("MOBILE_MONEY", "CARD", "PAYPAL")


class PaymentError(Exception):
    def __init__(self, key: str):
        super().__init__(key)
        self.key = key  # i18n message key


def charge_for(method: str, amount_xaf: int) -> tuple[str, str]:
    if method != "PAYPAL":
        return str(amount_xaf), "XAF"
    if settings.paypal_currency == "USD":
        return f"{amount_xaf / settings.xaf_per_usd:.2f}", "USD"
    return f"{amount_xaf / XAF_PER_EUR:.2f}", "EUR"


def method_available(method: str) -> bool:
    if settings.payments_sandbox:
        return True
    return settings.paypal_enabled if method == "PAYPAL" else settings.flutterwave_enabled


def _gateway_for(method: str):
    if settings.payments_sandbox:
        return sandbox
    if method == "PAYPAL":
        if not settings.paypal_enabled:
            raise PaymentError("payment.paypalUnavailable")
        return paypal
    if not settings.flutterwave_enabled:
        raise PaymentError("payment.methodUnavailable")
    return flutterwave


def normalise_phone(phone: str) -> str:
    """Cameroonian numbers: '6XXXXXXXX' → '2376XXXXXXXX'."""
    digits = "".join(c for c in phone if c.isdigit())
    return f"237{digits}" if len(digits) == 9 and digits.startswith("6") else digits


def create_checkout(user: User, plan: str, method: str, phone: str | None) -> str:
    """Create a pending payment and return the provider URL to redirect the customer to."""
    gateway = _gateway_for(method)
    amount, currency = charge_for(method, PLANS[plan].price_xaf)
    p = Payment(
        user_id=user.id,
        plan=plan,
        amount_xaf=PLANS[plan].price_xaf,
        charge_amount=amount,
        charge_currency=currency,
        method=method,
        provider=gateway.id,
        reference=payment_reference(),
        meta=dumps({"phone": phone}) if phone else None,
    )
    db.add(p)
    db.commit()
    try:
        url, provider_ref = gateway.create_checkout(p, user, method, phone, PLANS[plan].name["en"])
    except Exception as exc:  # noqa: BLE001
        p.status, p.failure_reason = "FAILED", str(exc)[:500]
        db.commit()
        log.error("checkout %s failed: %s", p.reference, exc)
        raise PaymentError("payment.gatewayError") from exc
    if provider_ref:
        p.provider_ref = provider_ref
        db.commit()
    log.info("checkout %s %s via %s/%s", p.reference, plan, gateway.id, method)
    return url


def verify_payment(reference: str, hint: dict | None = None) -> Payment | None:
    """Ask the provider for the payment's status and activate the plan on success. Idempotent."""
    p = db.scalar(select(Payment).where(Payment.reference == reference))
    if not p or p.status != "PENDING":
        return p
    result = GATEWAYS[p.provider].verify(p, hint)
    if result.status == "SUCCEEDED":
        if result.paid_currency != p.charge_currency or (result.paid_amount or 0) + 0.001 < float(p.charge_amount):
            log.error("amount mismatch on %s: got %s %s", reference, result.paid_amount, result.paid_currency)
            p.status, p.failure_reason = "FAILED", "Amount or currency mismatch"
            db.commit()
            return p
        # Claim atomically so concurrent verifications (redirect + webhook) activate only once.
        claimed = db.execute(
            update(Payment)
            .where(Payment.id == p.id, Payment.status == "PENDING")
            .values(status="SUCCEEDED", completed_at=utc_now(), provider_ref=result.provider_ref or p.provider_ref)
        ).rowcount
        if claimed:
            activate_plan(p.user_id, p.plan, payment_id=p.id)
            log.info("payment %s succeeded — %s activated", reference, p.plan)
        db.commit()
    elif result.status in ("FAILED", "CANCELLED"):
        db.execute(
            update(Payment)
            .where(Payment.id == p.id, Payment.status == "PENDING")
            .values(status=result.status, failure_reason=result.reason, provider_ref=result.provider_ref or p.provider_ref)
        )
        db.commit()
    db.refresh(p)
    return p


def complete_sandbox(reference: str, user_id: str, outcome: str) -> Payment | None:
    if not settings.payments_sandbox:
        return None
    p = db.scalar(select(Payment).where(Payment.reference == reference))
    if not p or p.user_id != user_id or p.provider != "SANDBOX":
        return None
    p.meta = dumps({**(loads(p.meta) or {}), "sandbox_outcome": outcome})
    db.commit()
    return verify_payment(reference)
