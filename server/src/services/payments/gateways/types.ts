import type { Payment } from "@prisma/client";

export type PayMethod = "ENKAP" | "MOBILE_MONEY" | "CARD" | "PAYPAL";
export type GatewayId = "ENKAP" | "FLUTTERWAVE" | "PAYPAL" | "SANDBOX";

export interface CheckoutContext {
  payment: Payment;
  user: { id: string; name: string; email: string; phone: string | null };
  method: PayMethod;
  phone?: string;
  planName: string;
}

export interface VerifyResult {
  status: "SUCCEEDED" | "FAILED" | "PENDING" | "CANCELLED";
  providerRef?: string;
  paidAmount?: number;
  paidCurrency?: string;
  reason?: string;
}

export interface PaymentGateway {
  readonly id: GatewayId;
  createCheckout(ctx: CheckoutContext): Promise<{ redirectUrl: string; providerRef?: string }>;
  /** Query the provider for the authoritative status of a payment. Never trust redirects or webhooks alone. */
  verify(payment: Payment, hint?: Record<string, string>): Promise<VerifyResult>;
}
