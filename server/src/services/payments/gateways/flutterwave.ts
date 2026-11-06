import type { Payment } from "@prisma/client";
import { env } from "../../../config/env.js";
import type { CheckoutContext, PaymentGateway, VerifyResult } from "./types.js";

/**
 * Flutterwave Standard (hosted checkout) — handles MTN MoMo / Orange Money in XAF
 * ("mobilemoneyfranco") and Visa/Mastercard ("card").
 * Docs: https://developer.flutterwave.com/docs/collecting-payments/standard
 */

const BASE_URL = "https://api.flutterwave.com/v3";

interface FlwResponse<T> {
  status: "success" | "error";
  message: string;
  data: T;
}

async function flw<T>(path: string, init: RequestInit = {}): Promise<FlwResponse<T>> {
  const res = await fetch(BASE_URL + path, {
    ...init,
    headers: { Authorization: `Bearer ${env.FLUTTERWAVE_SECRET_KEY}`, "Content-Type": "application/json", ...init.headers },
  });
  const body = (await res.json().catch(() => ({}))) as FlwResponse<T>;
  if (!res.ok || body.status !== "success") throw new Error(`Flutterwave ${path}: ${body.message ?? res.status}`);
  return body;
}

export const flutterwaveGateway: PaymentGateway = {
  id: "FLUTTERWAVE",

  async createCheckout(ctx: CheckoutContext) {
    const { payment, user } = ctx;
    const { data } = await flw<{ link: string }>("/payments", {
      method: "POST",
      body: JSON.stringify({
        tx_ref: payment.reference,
        amount: payment.amountXaf,
        currency: "XAF",
        redirect_url: `${env.APP_URL}/payment/return?reference=${encodeURIComponent(payment.reference)}`,
        payment_options: ctx.method === "MOBILE_MONEY" ? "mobilemoneyfranco" : "card",
        customer: { email: user.email, name: user.name, phonenumber: ctx.phone ?? user.phone ?? undefined },
        customizations: {
          title: "O-Jester",
          description: `${ctx.planName} plan — 30 days`,
          logo: `${env.APP_URL}/logo.svg`,
        },
        meta: { userId: user.id, plan: payment.plan },
      }),
    });
    return { redirectUrl: data.link };
  },

  async verify(payment: Payment): Promise<VerifyResult> {
    try {
      const { data } = await flw<{ id: number; status: string; amount: number; currency: string; tx_ref: string }>(
        `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(payment.reference)}`,
      );
      if (data.tx_ref !== payment.reference) return { status: "FAILED", reason: "Reference mismatch" };
      const status = data.status === "successful" ? "SUCCEEDED" : data.status === "failed" ? "FAILED" : "PENDING";
      return { status, providerRef: String(data.id), paidAmount: data.amount, paidCurrency: data.currency };
    } catch (err) {
      // Flutterwave returns an error until the customer has started a transaction.
      return { status: "PENDING", reason: err instanceof Error ? err.message : String(err) };
    }
  },
};
