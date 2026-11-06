import { Router } from "express";
import { limitsFor, type PlanId } from "../config/plans.js";
import { appToday } from "../lib/clock.js";
import { addDays, isDateString } from "../lib/dates.js";
import { badRequest, forbidden, notFound } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { comboLockTime, listCombos } from "../services/combos/service.js";
import { matchDetailView, matchListView } from "../services/views.js";

export const predictionsRouter = Router();

/** Resolve the requested date and check it against the plan's history / early-access window. */
function resolveDate(raw: unknown, plan: PlanId | null) {
  const today = appToday();
  const date = raw === undefined || raw === "" ? today : raw;
  if (!isDateString(date)) throw badRequest("validation.date");
  const limits = limitsFor(plan);
  if (date < addDays(today, -limits.historyDays)) {
    throw forbidden("dates.history", "HISTORY_LIMIT", {
      requiredPlan: limits.historyDays < 30 ? "PRO" : "ELITE",
    });
  }
  if (date > addDays(today, 1)) throw badRequest("dates.ahead");
  return { date, earlyAccessLocked: date > addDays(today, limits.daysAhead) };
}

predictionsRouter.get("/matches", async (req, res) => {
  const plan = req.auth?.plan ?? null;
  const { date, earlyAccessLocked } = resolveDate(req.query.date, plan);
  const matches = await prisma.match.findMany({
    where: { matchDate: date },
    include: { prediction: true },
    orderBy: [{ kickoff: "asc" }, { leagueName: "asc" }],
  });
  res.json({ date, earlyAccessLocked, matches: matches.map((m) => matchListView(m, { plan, earlyAccessLocked, lang: req.lang })) });
});

predictionsRouter.get("/matches/:id", async (req, res) => {
  const plan = req.auth?.plan ?? null;
  const match = await prisma.match.findUnique({ where: { id: req.params.id }, include: { prediction: true } });
  if (!match) throw notFound("match.notFound");
  const { earlyAccessLocked } = resolveDate(match.matchDate, plan);
  res.json({ match: matchDetailView(match, { plan, earlyAccessLocked, lang: req.lang }) });
});

predictionsRouter.get("/combos", async (req, res) => {
  const plan = req.auth?.plan ?? null;
  const { date, earlyAccessLocked } = resolveDate(req.query.date, plan);
  let combos = await listCombos(date, plan, req.lang);
  if (earlyAccessLocked) {
    combos = combos.map((c) => ({ ...c, locked: true, lockReason: "EARLY_ACCESS", minPlan: "ELITE", selections: null }));
  }
  res.json({ date, earlyAccessLocked, lockAt: comboLockTime(date).toISOString(), combos });
});
