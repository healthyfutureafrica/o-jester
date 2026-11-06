import { Router } from "express";
import { z } from "zod";
import { PLAN_IDS, type PlanId, PLANS } from "../config/plans.js";
import { appToday } from "../lib/clock.js";
import { notFound, validate } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";
import { runFullRefresh } from "../jobs/pipeline.js";
import { paymentView } from "../services/payments/service.js";
import { activatePlan, currentPlan } from "../services/subscriptions.js";
import { userView } from "./auth.js";

export const adminRouter = Router();
adminRouter.use("/admin", requireAdmin);

adminRouter.get("/admin/overview", async (_req, res) => {
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const [users, newUsers, activeSubs, revenue, recentPayments, jobs, matchesToday, combosToday] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: since30 } } }),
    prisma.subscription.findMany({
      where: { status: "ACTIVE", startsAt: { lte: now }, endsAt: { gt: now } },
      select: { plan: true, userId: true },
    }),
    prisma.payment.groupBy({
      by: ["plan"],
      where: { status: "SUCCEEDED", completedAt: { gte: since30 } },
      _sum: { amountXaf: true },
      _count: true,
    }),
    prisma.payment.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { user: { select: { email: true } } } }),
    prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 8 }),
    prisma.match.count({ where: { matchDate: appToday() } }),
    prisma.combo.count({ where: { date: appToday() } }),
  ]);

  const subscribers: Record<string, number> = { STARTER: 0, PRO: 0, ELITE: 0 };
  const seen = new Set<string>();
  for (const s of activeSubs) {
    if (seen.has(s.userId)) continue;
    seen.add(s.userId);
    subscribers[s.plan] = (subscribers[s.plan] ?? 0) + 1;
  }

  res.json({
    users,
    newUsers30d: newUsers,
    subscribers,
    revenue30d: {
      totalXaf: revenue.reduce((t, r) => t + (r._sum.amountXaf ?? 0), 0),
      byPlan: revenue.map((r) => ({ plan: r.plan, amountXaf: r._sum.amountXaf ?? 0, count: r._count })),
    },
    recentPayments: recentPayments.map((p) => ({ ...paymentView(p), email: p.user.email })),
    jobs: jobs.map((j) => ({ name: j.name, startedAt: j.startedAt, finishedAt: j.finishedAt, ok: j.ok, detail: j.detail })),
    today: { matches: matchesToday, combos: combosToday },
  });
});

adminRouter.get("/admin/users", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const users = await prisma.user.findMany({
    where: q ? { OR: [{ email: { contains: q } }, { name: { contains: q } }, { phone: { contains: q } }] } : {},
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const withPlans = await Promise.all(users.map(async (u) => ({ ...userView(u), plan: await currentPlan(u.id) })));
  res.json({ users: withPlans });
});

adminRouter.get("/admin/payments", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const payments = await prisma.payment.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { user: { select: { email: true, name: true } } },
  });
  res.json({ payments: payments.map((p) => ({ ...paymentView(p), email: p.user.email, name: p.user.name })) });
});

adminRouter.post("/admin/users/:id/grant", async (req, res) => {
  const body = validate(z.object({ plan: z.enum(PLAN_IDS), days: z.number().int().min(1).max(365) }), req.body);
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) throw notFound("user.notFound");
  const sub = await activatePlan(prisma, { userId: user.id, plan: body.plan as PlanId, days: body.days, source: "ADMIN_GRANT" });
  res.json({ ok: true, plan: PLANS[body.plan].name[req.lang], endsAt: sub.endsAt.toISOString() });
});

adminRouter.post("/admin/refresh", async (req, res) => {
  const force = Boolean(req.body?.force);
  void runFullRefresh({ force });
  res.status(202).json({ started: true, force });
});
