import type { User } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env, isProduction } from "../config/env.js";
import { type PlanId, PLANS, planAtLeast } from "../config/plans.js";
import { forbidden, unauthorized } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { currentPlan } from "../services/subscriptions.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { user: User; plan: PlanId | null };
    }
  }
}

export const SESSION_COOKIE = "oj_session";
const SESSION_DAYS = 30;

export function startSession(res: Response, userId: string) {
  const token = jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: SESSION_DAYS * 24 * 3600 * 1000,
    path: "/",
  });
}

export function endSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** Attach the signed-in user (if any) and their current plan to the request. */
export async function loadAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    try {
      const { sub } = jwt.verify(token, env.JWT_SECRET) as { sub: string };
      const user = await prisma.user.findUnique({ where: { id: sub } });
      if (user) req.auth = { user, plan: await currentPlan(user.id) };
    } catch {
      // invalid or expired token — treat as signed out
    }
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) throw unauthorized();
  next();
}

export const requirePlan = (min: PlanId) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth) throw unauthorized();
  if (!planAtLeast(req.auth.plan, min)) {
    throw forbidden("plan.required", "PLAN_REQUIRED", { requiredPlan: min }, { plan: PLANS[min].name[req.lang] });
  }
  next();
};

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) throw unauthorized();
  if (req.auth.user.role !== "ADMIN") throw forbidden();
  next();
}

/**
 * CSRF defence in depth (on top of SameSite=Lax cookies): state-changing API
 * calls must carry a custom header, which cross-site forms cannot set.
 * Provider callbacks are exempt — integrations must verify callback authenticity
 * or query the provider server-to-server before applying any state changes.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  const safe = ["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (!safe && !req.path.startsWith("/payments/webhooks") && req.get("x-oj-client") !== "web") {
    throw forbidden("auth.csrf", "CSRF");
  }
  next();
}
