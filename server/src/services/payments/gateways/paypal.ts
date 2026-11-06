import type { Payment } from "@prisma/client";
import { env } from "../../../config/env.js";
import type { CheckoutContext, PaymentGateway, VerifyResult } from "./types.js";

/**
 * PayPal Orders v2. PayPal does not settle in XAF, so plans are charged in
 * EUR (fixed CFA peg) or USD — see payments/service.ts.
 * Docs: https://developer.paypal.com/docs/api/orders/v2/
 */

const BASE_URL = env.PAYPAL_MODE === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

let cachedToken: { value: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed: HTTP ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

export async function paypalRequest<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const res = await fetch(BASE_URL + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      ...(init.idempotencyKey ? { "PayPal-Request-Id": init.idempotencyKey } : {}),
      ...init.headers,
    },
  });
  const body = (await res.json().catch(() => ({}))) as T & { message?: string; name?: string };
  if (!res.ok) throw new Error(`PayPal ${path}: ${body.name ?? res.status} ${body.message ?? ""}`.trim());
  return body;
}

interface PaypalOrder {
  id: string;
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
  links: { href: string; rel: string }[];
  purchase_units?: {
    reference_id?: string;
    payments?: { captures?: { id: string; status: string; amount: { currency_code: string; value: string } }[] };
  }[];
}

function captureResult(order: PaypalOrder): VerifyResult {
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  if (!capture) return { status: "PENDING", providerRef: order.id };
  if (capture.status === "COMPLETED") {
    return {
      status: "SUCCEEDED",
      providerRef: order.id,
      paidAmount: Number(capture.amount.value),
      paidCurrency: capture.amount.currency_code,
    };
  }
  return capture.status === "PENDING" ? { status: "PENDING", providerRef: order.id } : { status: "FAILED", providerRef: order.id, reason: capture.status };
}

export const paypalGateway: PaymentGateway = {
  id: "PAYPAL",

  async createCheckout(ctx: CheckoutContext) {
    const { payment } = ctx;
    const returnUrl = `${env.APP_URL}/payment/return?reference=${encodeURIComponent(payment.reference)}`;
    const order = await paypalRequest<PaypalOrder>("/v2/checkout/orders", {
      method: "POST",
      idempotencyKey: payment.reference,
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: payment.reference,
            custom_id: payment.reference,
            description: `O-Jester ${ctx.planName} — 30 days`,
            amount: { currency_code: payment.chargeCurrency, value: payment.chargeAmount },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: "O-Jester",
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
              return_url: returnUrl,
              cancel_url: `${returnUrl}&cancelled=1`,
            },
          },
        },
      }),
    });
    const approve = order.links.find((l) => l.rel === "payer-action" || l.rel === "approve");
    if (!approve) throw new Error("PayPal did not return an approval link");
    return { redirectUrl: approve.href, providerRef: order.id };
  },

  async verify(payment: Payment, hint?: Record<string, string>): Promise<VerifyResult> {
    if (!payment.providerRef) return { status: "FAILED", reason: "Missing PayPal order id" };
    const order = await paypalRequest<PaypalOrder>(`/v2/checkout/orders/${payment.providerRef}`);
    if (order.status === "COMPLETED") return captureResult(order);
    if (order.status === "APPROVED") {
      const captured = await paypalRequest<PaypalOrder>(`/v2/checkout/orders/${order.id}/capture`, {
        method: "POST",
        idempotencyKey: `${payment.reference}-capture`,
      });
      return captureResult(captured);
    }
    if (order.status === "VOIDED") return { status: "FAILED", providerRef: order.id, reason: "Order voided" };
    if (hint?.cancelled) return { status: "CANCELLED", providerRef: order.id };
    return { status: "PENDING", providerRef: order.id };
  },
};

/** Verify a webhook's authenticity with PayPal. Requires PAYPAL_WEBHOOK_ID. */
export async function verifyPaypalWebhook(headers: Record<string, string | undefined>, event: unknown): Promise<boolean> {
  if (!env.PAYPAL_WEBHOOK_ID) return false;
  const result = await paypalRequest<{ verification_status: string }>("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: JSON.stringify({
      auth_algo: headers["paypal-auth-algo"],
      cert_url: headers["paypal-cert-url"],
      transmission_id: headers["paypal-transmission-id"],
      transmission_sig: headers["paypal-transmission-sig"],
      transmission_time: headers["paypal-transmission-time"],
      webhook_id: env.PAYPAL_WEBHOOK_ID,
      webhook_event: event,
    }),
  });
  return result.verification_status === "SUCCESS";
}
