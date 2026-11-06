import bcrypt from "bcryptjs";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { limitsFor } from "../config/plans.js";
import { msg } from "../i18n/index.js";
import { ageOn, MIN_AGE } from "../lib/age.js";
import { HttpError, unauthorized, validate } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { endSession, requireAuth, startSession } from "../middleware/auth.js";
import { subscriptionSummary } from "../services/subscriptions.js";

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: { code: "RATE_LIMITED", message: msg(req.lang, "auth.tooMany") } });
  },
});

export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .refine((v) => /^\+?\d{8,15}$/.test(v), "validation.phone");

const registerSchema = z.object({
  name: z.string({ required_error: "validation.name" }).trim().min(2, "validation.name").max(60, "validation.name"),
  email: z.string({ required_error: "validation.email" }).trim().toLowerCase().email("validation.email"),
  password: z.string({ required_error: "validation.password" }).min(8, "validation.password").max(128, "validation.password"),
  phone: phoneSchema.optional().or(z.literal("").transform(() => undefined)),
  birthDate: z
    .string({ required_error: "validation.birthDate" })
    .regex(/^\d{4}-\d{2}-\d{2}$/, "validation.birthDate")
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && ageOn(v) <= 120 && ageOn(v) >= 0, "validation.birthDate"),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "validation.terms" }) }),
});

const loginSchema = z.object({
  email: z.string({ required_error: "validation.email" }).trim().toLowerCase().email("validation.email"),
  password: z.string({ required_error: "validation.passwordRequired" }).min(1, "validation.passwordRequired"),
});

export function userView(u: { id: string; name: string; email: string; phone: string | null; role: string; createdAt: Date }) {
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, createdAt: u.createdAt.toISOString() };
}

authRouter.post("/register", authLimiter, async (req, res) => {
  const body = validate(registerSchema, req.body);
  // Legal age requirement — enforced server-side, not just in the UI.
  if (ageOn(body.birthDate) < MIN_AGE) throw new HttpError(403, "auth.underage", "UNDERAGE");
  const exists = await prisma.user.findUnique({ where: { email: body.email } });
  if (exists) throw new HttpError(409, "auth.emailTaken", "EMAIL_TAKEN");
  const user = await prisma.user.create({
    data: {
      name: body.name,
      email: body.email,
      phone: body.phone,
      birthDate: new Date(`${body.birthDate}T00:00:00Z`),
      termsAcceptedAt: new Date(),
      passwordHash: await bcrypt.hash(body.password, 12),
    },
  });
  startSession(res, user.id);
  res.status(201).json({ user: userView(user), subscription: null, limits: limitsFor(null) });
});

authRouter.post("/login", authLimiter, async (req, res) => {
  const body = validate(loginSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  // Compare against a dummy hash when the user doesn't exist to keep timing uniform.
  const ok = await bcrypt.compare(body.password, user?.passwordHash ?? "$2b$12$C6UzMDM.H6dfI/f/IKcEeO3b2qgQh0w6f7B9yJ8v0x0p9vZ5L6Q3e");
  if (!user || !ok) throw unauthorized("auth.badCredentials");
  startSession(res, user.id);
  const subscription = await subscriptionSummary(user.id);
  res.json({ user: userView(user), subscription, limits: limitsFor(subscription?.plan) });
});

authRouter.post("/logout", (_req, res) => {
  endSession(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const { user, plan } = req.auth!;
  res.json({ user: userView(user), subscription: await subscriptionSummary(user.id), limits: limitsFor(plan) });
});
