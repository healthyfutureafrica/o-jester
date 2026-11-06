import type { Prisma, Subscription } from "@prisma/client";
import { isPlanId, PLAN_RANK, type PlanId, PLANS, SUBSCRIPTION_DAYS } from "../config/plans.js";
import { prisma } from "../lib/prisma.js";

type Db = Prisma.TransactionClient | typeof prisma;
const DAY = 24 * 3600 * 1000;

const rank = (s: Subscription) => (isPlanId(s.plan) ? PLAN_RANK[s.plan] : 0);

async function liveSubscriptions(userId: string, now: Date, db: Db = prisma) {
  return db.subscription.findMany({ where: { userId, status: "ACTIVE", endsAt: { gt: now } }, orderBy: { startsAt: "asc" } });
}

/** The highest-ranked plan the user is entitled to right now, or null. */
export async function currentPlan(userId: string, now = new Date()): Promise<PlanId | null> {
  const running = (await liveSubscriptions(userId, now)).filter((s) => s.startsAt <= now);
  if (!running.length) return null;
  const best = running.reduce((a, b) => (rank(b) > rank(a) ? b : a));
  return isPlanId(best.plan) ? best.plan : null;
}

export async function subscriptionSummary(userId: string, now = new Date()) {
  const subs = await liveSubscriptions(userId, now);
  const running = subs.filter((s) => s.startsAt <= now);
  if (!running.length) return null;
  const current = running.reduce((a, b) => (rank(b) > rank(a) ? b : a));
  // Follow back-to-back renewals of the same plan to find the effective end date.
  let endsAt = current.endsAt;
  for (const s of subs) {
    if (s.id !== current.id && s.plan === current.plan && s.startsAt.getTime() <= endsAt.getTime() + 60000 && s.endsAt > endsAt) {
      endsAt = s.endsAt;
    }
  }
  const plan = current.plan as PlanId;
  return {
    plan,
    startsAt: current.startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    daysLeft: Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / DAY)),
    queued: subs
      .filter((s) => s.startsAt >= endsAt)
      .map((s) => ({ plan: s.plan, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() })),
  };
}

/**
 * Grant `days` of `plan` to a user.
 *  - No live subscription  → starts now.
 *  - Upgrade (higher plan) → starts now; the unused value of current/queued
 *    subscriptions is converted pro-rata into extra days on the new plan.
 *  - Renewal or downgrade  → queued to start when the existing entitlement ends.
 */
export async function activatePlan(
  db: Db,
  opts: { userId: string; plan: PlanId; days?: number; paymentId?: string; source?: "PAYMENT" | "ADMIN_GRANT"; now?: Date },
) {
  const now = opts.now ?? new Date();
  const days = opts.days ?? SUBSCRIPTION_DAYS;
  const live = await liveSubscriptions(opts.userId, now, db);
  const newRank = PLAN_RANK[opts.plan];
  const maxRank = live.reduce((m, s) => Math.max(m, rank(s)), 0);

  let startsAt = now;
  let extraMs = 0;
  if (live.length && newRank > maxRank) {
    const creditXafMs = live.reduce((sum, s) => {
      const remaining = s.endsAt.getTime() - Math.max(s.startsAt.getTime(), now.getTime());
      const price = isPlanId(s.plan) ? PLANS[s.plan].priceXaf : 0;
      return sum + Math.max(0, remaining) * price;
    }, 0);
    extraMs = creditXafMs / PLANS[opts.plan].priceXaf;
    await db.subscription.updateMany({
      where: { id: { in: live.map((s) => s.id) } },
      data: { status: "SUPERSEDED", endsAt: now },
    });
  } else if (live.length) {
    startsAt = new Date(Math.max(...live.map((s) => s.endsAt.getTime())));
  }

  return db.subscription.create({
    data: {
      userId: opts.userId,
      plan: opts.plan,
      source: opts.source ?? "PAYMENT",
      startsAt,
      endsAt: new Date(startsAt.getTime() + days * DAY + extraMs),
      paymentId: opts.paymentId,
    },
  });
}
