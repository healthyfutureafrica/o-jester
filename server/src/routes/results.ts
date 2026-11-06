import { Router } from "express";
import { z } from "zod";
import { limitsFor } from "../config/plans.js";
import { appToday } from "../lib/clock.js";
import { addDays } from "../lib/dates.js";
import { validate } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { requirePlan } from "../middleware/auth.js";
import { COMBO_TYPES } from "../services/combos/builder.js";
import { comboLockTime } from "../services/combos/service.js";
import { settleMarket } from "../services/predictions/markets.js";
import { comboView } from "../services/views.js";

export const resultsRouter = Router();

const querySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

const rate = (won: number, settled: number) => (settled ? Math.round((won / settled) * 1000) / 10 : null);

/**
 * Public track record. Aggregate statistics are visible to everyone (transparency);
 * the list of individual settled combos follows the plan's history window.
 */
resultsRouter.get("/results", async (req, res) => {
  const { days } = validate(querySchema, req.query);
  const plan = req.auth?.plan ?? null;
  const today = appToday();
  const from = addDays(today, -days);

  const [combos, predictions] = await Promise.all([
    prisma.combo.findMany({
      where: { date: { gte: from, lte: today }, status: { not: "PENDING" } },
      include: { selections: { include: { match: true } } },
      orderBy: { date: "desc" },
    }),
    prisma.prediction.findMany({
      where: { match: { matchDate: { gte: from, lte: today }, status: "FINISHED" } },
      select: { bestMarket: true, match: { select: { homeGoals: true, awayGoals: true } } },
    }),
  ]);

  const accas = combos.filter((c) => c.kind === "ACCA" && c.status !== "VOID");
  const wonAccas = accas.filter((c) => c.status === "WON");
  const legs = combos.flatMap((c) => c.selections).filter((s) => s.result === "WON" || s.result === "LOST");
  const bestPicks = predictions.filter((p) => p.match.homeGoals !== null && p.match.awayGoals !== null);
  const bestWon = bestPicks.filter((p) => settleMarket(p.bestMarket, p.match.homeGoals!, p.match.awayGoals!) === "WON");

  const byType = COMBO_TYPES.map((t) => {
    const ofType = combos.filter((c) => c.type === t.type && c.status !== "VOID");
    const typeLegs = ofType.flatMap((c) => c.selections).filter((s) => s.result === "WON" || s.result === "LOST");
    const won = t.kind === "ACCA" ? ofType.filter((c) => c.status === "WON").length : typeLegs.filter((s) => s.result === "WON").length;
    const settled = t.kind === "ACCA" ? ofType.length : typeLegs.length;
    return { type: t.type, title: t.title[req.lang], minPlan: t.minPlan, kind: t.kind, settled, won, winRate: rate(won, settled) };
  });

  const historyFrom = addDays(today, -limitsFor(plan).historyDays);
  const recent = combos
    .filter((c) => c.date >= historyFrom)
    .slice(0, 60)
    .map((c) => comboView(c, plan, comboLockTime(c.date), req.lang));

  res.json({
    days,
    summary: {
      combos: { settled: accas.length, won: wonAccas.length, winRate: rate(wonAccas.length, accas.length) },
      selections: { settled: legs.length, won: legs.filter((s) => s.result === "WON").length, winRate: rate(legs.filter((s) => s.result === "WON").length, legs.length) },
      bestPicks: { settled: bestPicks.length, won: bestWon.length, winRate: rate(bestWon.length, bestPicks.length) },
      avgWinningOdds: wonAccas.length ? Math.round((wonAccas.reduce((s, c) => s + c.totalOdds, 0) / wonAccas.length) * 100) / 100 : null,
    },
    byType,
    recent,
    historyDays: limitsFor(plan).historyDays,
  });
});

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

resultsRouter.get("/results/export.csv", requirePlan("ELITE"), async (_req, res) => {
  const selections = await prisma.comboSelection.findMany({
    include: { combo: true, match: true },
    orderBy: [{ combo: { date: "desc" } }, { position: "asc" }],
    take: 20000,
  });
  const header = ["date", "combo", "combo_status", "combo_odds", "league", "kickoff_utc", "home", "away", "selection", "market", "odds", "model_probability", "score", "result"];
  const rows = selections.map((s) => [
    s.combo.date,
    s.combo.title,
    s.combo.status,
    s.combo.totalOdds,
    s.match.leagueName,
    s.match.kickoff.toISOString(),
    s.match.homeTeam,
    s.match.awayTeam,
    s.label,
    s.market,
    s.odds,
    s.probability,
    s.match.homeGoals !== null ? `${s.match.homeGoals}-${s.match.awayGoals}` : "",
    s.result,
  ]);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="o-jester-results-${appToday()}.csv"`);
  res.send([header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n"));
});
