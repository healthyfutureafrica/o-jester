import type { Payment, User } from "@prisma/client";
import { env, paymentConfig } from "../../config/env.js";
import { type PlanId, PLANS } from "../../config/plans.js";
import { HttpError } from "../../lib/http.js";
import { createLogger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { parseJson, paymentReference } from "../../lib/util.js";
import { activatePlan } from "../subscriptions.js";
import { enkapGateway } from "./gateways/enkap.js";
import { flutterwaveGateway } from "./gateways/flutterwave.js";
import { paypalGateway } from "./gateways/paypal.js";
import { sandboxGateway } from "./gateways/sandbox.js";
import type { PayMethod, PaymentGateway } from "./gateways/types.js";

const log = createLogger("payments");

/** The CFA franc is pegged to the euro: 1 EUR = 655.957 XAF. */
export const XAF_PER_EUR = 655.957;

export function chargeFor(method: PayMethod, amountXaf: number): { amount: string; currency: string } {
  if (method !== "PAYPAL") return { amount: String(amountXaf), currency: "XAF" };
  return env.PAYPAL_CURRENCY === "EUR"
    ? { amount: (amountXaf / XAF_PER_EUR).toFixed(2), currency: "EUR" }
    : { amount: (amountXaf / env.XAF_PER_USD).toFixed(2), currency: "USD" };
}

export function paymentMethods() {
  const sandbox = paymentConfig.sandbox;
  return [{ method: "ENKAP" as const, available: sandbox || paymentConfig.enkap }];
}

function gatewayFor(method: PayMethod): PaymentGateway {
  if (paymentConfig.sandbox) return sandboxGateway;
  if (method !== "ENKAP" || !paymentConfig.enkap) {
    throw new HttpError(503, "payment.methodUnavailable", "METHOD_UNAVAILABLE");
  }
  return enkapGateway;
}

const gatewaysById: Record<string, PaymentGateway> = {
  ENKAP: enkapGateway,
  FLUTTERWAVE: flutterwaveGateway,
  PAYPAL: paypalGateway,
  SANDBOX: sandboxGateway,
};

export async function createCheckout(user: User, plan: PlanId, method: PayMethod, phone?: string) {
  if (method !== "ENKAP") throw new HttpError(400, "payment.methodUnavailable", "METHOD_UNAVAILABLE");
  const def = PLANS[plan];
  const gateway = gatewayFor(method);
  const charge = chargeFor(method, def.priceXaf);
  const payment = await prisma.payment.create({
    data: {
      userId: user.id,
      plan,
      amountXaf: def.priceXaf,
      chargeAmount: charge.amount,
      chargeCurrency: charge.currency,
      method,
      provider: gateway.id,
      reference: paymentReference(),
      meta: phone ? JSON.stringify({ phone }) : null,
    },
  });
  try {
    const { redirectUrl, providerRef } = await gateway.createCheckout({ payment, user, method, phone, planName: def.name.en });
    if (providerRef) await prisma.payment.update({ where: { id: payment.id }, data: { providerRef } });
    log.info(`checkout ${payment.reference} ${plan} via ${gateway.id}/${method}`);
    return { reference: payment.reference, redirectUrl };
  } catch (err) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED", failureReason: err instanceof Error ? err.message : String(err) },
    });
    log.error(`checkout ${payment.reference} failed`, err);
    throw new HttpError(502, "payment.gatewayError", "GATEWAY_ERROR");
  }
}

/**
 * Ask the provider for the authoritative status of a payment and, on success,
 * activate the subscription. Idempotent — safe to call from redirects,
 * webhooks and polling concurrently.
 */
export async function verifyPayment(reference: string, hint?: Record<string, string>): Promise<Payment> {
  const payment = await prisma.payment.findUnique({ where: { reference } });
  if (!payment) throw new HttpError(404, "payment.notFound", "NOT_FOUND");
  if (payment.status !== "PENDING") return payment;

  const gateway = gatewaysById[payment.provider];
  const result = await gateway.verify(payment, hint);

  if (result.status === "SUCCEEDED") {
    const expected = Number(payment.chargeAmount);
    if (result.paidCurrency !== payment.chargeCurrency || (result.paidAmount ?? 0) + 0.001 < expected) {
      log.error(`amount mismatch on ${reference}: got ${result.paidAmount} ${result.paidCurrency}, expected ${expected} ${payment.chargeCurrency}`);
      return prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED", failureReason: "Amount or currency mismatch", providerRef: result.providerRef ?? payment.providerRef },
      });
    }
    await fulfil(payment, result.providerRef);
  } else if (result.status === "FAILED" || result.status === "CANCELLED") {
    await prisma.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status: result.status, failureReason: result.reason ?? null, providerRef: result.providerRef ?? payment.providerRef },
    });
  }
  return (await prisma.payment.findUnique({ where: { id: payment.id } }))!;
}

async function fulfil(payment: Payment, providerRef?: string) {
  await prisma.$transaction(async (tx) => {
    // Claim the payment atomically so concurrent verifications activate only once.
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status: "SUCCEEDED", completedAt: new Date(), providerRef: providerRef ?? payment.providerRef },
    });
    if (claimed.count === 0) return;
    await activatePlan(tx, { userId: payment.userId, plan: payment.plan as PlanId, paymentId: payment.id });
  });
  log.info(`payment ${payment.reference} succeeded — ${payment.plan} activated`);
}

export async function completeSandboxPayment(reference: string, userId: string, outcome: "success" | "fail") {
  if (!paymentConfig.sandbox) throw new HttpError(404, "error.notFound", "NOT_FOUND");
  const payment = await prisma.payment.findUnique({ where: { reference } });
  if (!payment || payment.userId !== userId || payment.provider !== "SANDBOX") throw new HttpError(404, "payment.notFound", "NOT_FOUND");
  const meta = { ...parseJson<Record<string, unknown>>(payment.meta, {}), sandboxOutcome: outcome };
  await prisma.payment.update({ where: { id: payment.id }, data: { meta: JSON.stringify(meta) } });
  return verifyPayment(reference);
}

export function paymentView(p: Payment) {
  return {
    reference: p.reference,
    plan: p.plan,
    amountXaf: p.amountXaf,
    chargeAmount: p.chargeAmount,
    chargeCurrency: p.chargeCurrency,
    method: p.method,
    provider: p.provider,
    status: p.status,
    failureReason: p.status === "FAILED" ? p.failureReason : null,
    createdAt: p.createdAt.toISOString(),
    completedAt: p.completedAt?.toISOString() ?? null,
  };
}
