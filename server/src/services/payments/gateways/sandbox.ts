import type { Payment } from "@prisma/client";
import { env } from "../../../config/env.js";
import { parseJson } from "../../../lib/util.js";
import type { CheckoutContext, PaymentGateway, VerifyResult } from "./types.js";

/**
 * Local test gateway (PAYMENTS_SANDBOX=true). Sends the user to an in-app mock
 * checkout page where they approve or decline; no money moves.
 */
export const sandboxGateway: PaymentGateway = {
  id: "SANDBOX",

  async createCheckout(ctx: CheckoutContext) {
    return { redirectUrl: `${env.APP_URL}/payment/sandbox?reference=${encodeURIComponent(ctx.payment.reference)}` };
  },

  async verify(payment: Payment): Promise<VerifyResult> {
    const outcome = parseJson<{ sandboxOutcome?: string }>(payment.meta, {}).sandboxOutcome;
    if (outcome === "success") {
      return { status: "SUCCEEDED", providerRef: `SBX-${payment.reference}`, paidAmount: Number(payment.chargeAmount), paidCurrency: payment.chargeCurrency };
    }
    if (outcome === "fail") return { status: "FAILED", reason: "Declined in sandbox" };
    return { status: "PENDING" };
  },
};
