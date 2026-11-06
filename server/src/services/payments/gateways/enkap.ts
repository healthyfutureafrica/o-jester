import type { Payment } from "@prisma/client";
import { env } from "../../../config/env.js";
import type { CheckoutContext, PaymentGateway, VerifyResult } from "./types.js";

interface EnkapOrderResponse {
  orderTransactionId: string;
  merchantReferenceId: string;
  redirectUrl: string;
}

interface EnkapOrderDetails {
  id?: { uuid?: string };
  paymentStatus?: string;
  order?: {
    currency?: string;
    merchantReference?: string;
    totalAmount?: number;
  };
}

async function enkapRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!env.ENKAP_API_BASE_URL || !env.ENKAP_ACCESS_TOKEN) {
    throw new Error("ENKAP_API_BASE_URL and ENKAP_ACCESS_TOKEN must be configured");
  }

  const apiBase = new URL(env.ENKAP_API_BASE_URL);
  if (apiBase.protocol !== "https:") throw new Error("ENKAP_API_BASE_URL must use HTTPS");
  const baseUrl = apiBase.toString().replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${env.ENKAP_ACCESS_TOKEN}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) {
    throw new Error(`ENKAP ${path}: ${body.message ?? `HTTP ${response.status}`}`);
  }
  return body;
}

function statusResult(status: string | undefined, providerRef?: string): VerifyResult {
  switch (status?.toUpperCase()) {
    case "CONFIRMED":
    case "PAID":
      return { status: "SUCCEEDED", providerRef };
    case "FAILED":
      return { status: "FAILED", providerRef, reason: "Payment failed" };
    case "CANCELED":
    case "CANCELLED":
      return { status: "CANCELLED", providerRef, reason: "Payment cancelled" };
    default:
      return { status: "PENDING", providerRef };
  }
}

export const enkapGateway: PaymentGateway = {
  id: "ENKAP",

  async createCheckout(ctx: CheckoutContext) {
    const { payment, user } = ctx;
    const returnUrl = `${env.API_URL.replace(/\/+$/, "")}/api/payments/enkap/return`;
    const notificationUrl = `${env.API_URL.replace(/\/+$/, "")}/api/payments/webhooks/enkap`;
    const response = await enkapRequest<EnkapOrderResponse>("/api/order", {
      method: "POST",
      body: JSON.stringify({
        currency: "XAF",
        customerName: user.name.slice(0, 50),
        description: `O-Jester ${ctx.planName} subscription`,
        email: user.email,
        expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        id: { uuid: payment.reference, version: "V1.2" },
        items: [
          {
            itemId: payment.plan,
            particulars: `${ctx.planName} subscription`.slice(0, 50),
            quantity: 1,
            subTotal: payment.amountXaf,
            unitCost: payment.amountXaf,
          },
        ],
        langKey: "en",
        merchantReference: payment.reference,
        orderDate: new Date().toISOString(),
        phoneNumber: user.phone ?? undefined,
        receiptUrl: `${env.APP_URL.replace(/\/+$/, "")}/account`,
        returnUrl,
        notificationUrl,
        totalAmount: payment.amountXaf,
      }),
    });

    if (!response.orderTransactionId || !response.redirectUrl || response.merchantReferenceId !== payment.reference) {
      throw new Error("ENKAP returned an invalid order response");
    }

    const redirectUrl = new URL(response.redirectUrl);
    if (redirectUrl.protocol !== "https:") throw new Error("ENKAP returned a non-HTTPS checkout URL");
    return { redirectUrl: redirectUrl.toString(), providerRef: response.orderTransactionId };
  },

  async verify(payment: Payment): Promise<VerifyResult> {
    const query = payment.providerRef
      ? `txid=${encodeURIComponent(payment.providerRef)}`
      : `orderMerchantId=${encodeURIComponent(payment.reference)}`;
    const details = await enkapRequest<EnkapOrderDetails>(`/api/order?${query}`);
    const providerRef = details.id?.uuid ?? payment.providerRef ?? undefined;
    if (details.order?.merchantReference !== payment.reference) {
      return { status: "FAILED", providerRef, reason: "Reference mismatch" };
    }

    const result = statusResult(details.paymentStatus, providerRef);
    if (result.status !== "SUCCEEDED") return result;
    return {
      ...result,
      paidAmount: details.order.totalAmount,
      paidCurrency: details.order.currency,
    };
  },
};
