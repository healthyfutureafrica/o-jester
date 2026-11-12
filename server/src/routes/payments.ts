import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { PLAN_IDS } from "../config/plans.js";
import { notFound, validate } from "../lib/http.js";
import { createLogger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { verifyPaypalWebhook } from "../services/payments/gateways/paypal.js";
import { completeSandboxPayment, createCheckout, paymentView, verifyPayment } from "../services/payments/service.js";
import { subscriptionSummary } from "../services/subscriptions.js";

export const paymentsRouter = Router();
const log = createLogger("payments-api");

const checkoutSchema = z.object({
  plan: z.enum(PLAN_IDS),
  method: z.literal("ENKAP"),
});

paymentsRouter.post("/payments/checkout", requireAuth, async (req, res) => {
  const body = validate(checkoutSchema, req.body);
  const user = req.auth!.user;
  const checkout = await createCheckout(user, body.plan, body.method);
  res.status(201).json(checkout);
});

paymentsRouter.get("/payments", requireAuth, async (req, res) => {
  const payments = await prisma.payment.findMany({
    where: { userId: req.auth!.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json({ payments: payments.map(paymentView) });
});

/** Called by the return page after the provider redirects back; verifies with the provider. */
paymentsRouter.get("/payments/:reference", requireAuth, async (req, res) => {
  const existing = await prisma.payment.findUnique({ where: { reference: String(req.params.reference) } });
  if (!existing || existing.userId !== req.auth!.user.id) throw notFound("payment.notFound");
  const hint = req.query.cancelled ? { cancelled: "1" } : undefined;
  const payment = await verifyPayment(existing.reference, hint);
  res.json({ payment: paymentView(payment), subscription: await subscriptionSummary(payment.userId) });
});

paymentsRouter.post("/payments/sandbox/complete", requireAuth, async (req, res) => {
  const body = validate(z.object({ reference: z.string(), outcome: z.enum(["success", "fail"]) }), req.body);
  const payment = await completeSandboxPayment(body.reference, req.auth!.user.id, body.outcome);
  res.json({ payment: paymentView(payment) });
});

// --- Provider webhooks (authenticated by signature, exempt from CSRF guard) ---------

paymentsRouter.get("/payments/enkap/return/:reference", (req, res) => {
  const returnUrl = new URL("/payment/return", env.APP_URL);
  returnUrl.searchParams.set("reference", String(req.params.reference));
  res.redirect(302, returnUrl.toString());
});

function handleEnkapWebhook(req: Request, res: Response) {
  const reference = String(req.params.reference);
  res.status(200).json({ received: true });
  void verifyPayment(reference).catch((err) => log.error(`ENKAP notification verification failed for ${reference}`, err));
}

paymentsRouter.post("/payments/webhooks/enkap/:reference", handleEnkapWebhook);
paymentsRouter.put("/payments/webhooks/enkap/:reference", handleEnkapWebhook);

paymentsRouter.post("/payments/webhooks/flutterwave", async (req, res) => {
  if (!env.FLUTTERWAVE_WEBHOOK_HASH || req.get("verif-hash") !== env.FLUTTERWAVE_WEBHOOK_HASH) {
    res.status(401).end();
    return;
  }
  const ref = req.body?.data?.tx_ref ?? req.body?.txRef;
  res.status(200).json({ received: true });
  if (typeof ref === "string") {
    verifyPayment(ref).catch((err) => log.error(`flutterwave webhook verify failed for ${ref}`, err));
  }
});

paymentsRouter.post("/payments/webhooks/paypal", async (req, res) => {
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const valid = await verifyPaypalWebhook(headers, req.body).catch(() => false);
  if (!valid) {
    res.status(401).end();
    return;
  }
  res.status(200).json({ received: true });
  const resource = req.body?.resource ?? {};
  const ref: unknown = resource.custom_id ?? resource.purchase_units?.[0]?.reference_id ?? resource.purchase_units?.[0]?.custom_id;
  if (typeof ref === "string") {
    verifyPayment(ref).catch((err) => log.error(`paypal webhook verify failed for ${ref}`, err));
  }
});
