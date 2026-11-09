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

async function getEnkapAccessToken(): Promise<string> {
  if (env.ENKAP_ACCESS_TOKEN) return env.ENKAP_ACCESS_TOKEN;

  if (!env.ENKAP_TOKEN_URL || !env.ENKAP_CONSUMER_KEY || !env.ENKAP_CONSUMER_SECRET) {
    throw new Error("ENKAP_TOKEN_URL, ENKAP_CONSUMER_KEY and ENKAP_CONSUMER_SECRET must be configured when ENKAP_ACCESS_TOKEN is absent");
  }

  const tokenResponse = await fetch(env.ENKAP_TOKEN_URL, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.ENKAP_CONSUMER_KEY}:${env.ENKAP_CONSUMER_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
  });

  const tokenData = (await tokenResponse.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!tokenResponse.ok || !tokenData.access_token) {
    throw new Error(`ENKAP token request failed: ${tokenData.error_description ?? tokenData.error ?? `HTTP ${tokenResponse.status}`}`);
  }

  return tokenData.access_token;
}

async function enkapRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const hasAccessToken = Boolean(env.ENKAP_ACCESS_TOKEN);
  const hasConsumerCredentials = Boolean(env.ENKAP_TOKEN_URL && env.ENKAP_CONSUMER_KEY && env.ENKAP_CONSUMER_SECRET);
  const hasApiCredentials = Boolean(env.ENKAP_API_KEY && env.ENKAP_API_SECRET);
  if (!env.ENKAP_API_BASE_URL || (!hasAccessToken && !hasConsumerCredentials && !hasApiCredentials)) {
    throw new Error("ENKAP_API_BASE_URL and valid ENKAP credentials must be configured");
  }

  const apiBase = new URL(env.ENKAP_API_BASE_URL);
  if (apiBase.protocol !== "https:") throw new Error("ENKAP_API_BASE_URL must use HTTPS");
  const baseUrl = apiBase.toString().replace(/\/+$/, "");
  const accessToken = await getEnkapAccessToken();

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(env.ENKAP_API_KEY ? { "X-API-Key": env.ENKAP_API_KEY } : {}),
      ...(env.ENKAP_API_SECRET ? { "X-API-Secret": env.ENKAP_API_SECRET } : {}),
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
