import { createLogger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { parseJson } from "../../lib/util.js";
import type { MatchAnalysis } from "../ai/analyst.js";
import type { BookOdds, MatchStatsInput } from "../football/types.js";
import { confidenceFor, predictMatch } from "./engine.js";
import { settleMarket } from "./markets.js";

const log = createLogger("predictions");

/**
 * (Re)compute predictions for a date. Only matches that have not kicked off are
 * updated, so a published prediction is frozen once the game starts.
 */
export async function predictDate(date: string) {
  const now = new Date();
  const matches = await prisma.match.findMany({
    where: { matchDate: date },
    include: { prediction: { select: { id: true, aiAnalysis: true } } },
  });
  let count = 0;
  for (const m of matches) {
    if (m.status !== "SCHEDULED" || m.kickoff <= now) continue;

    const result = predictMatch({
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      stats: parseJson<MatchStatsInput | null>(m.teamStats, null),
      odds: parseJson<BookOdds | null>(m.odds, null),
    });
    const ai = parseJson<MatchAnalysis | null>(m.prediction?.aiAnalysis, null);
    const data = {
      lambdaHome: result.lambdaHome,
      lambdaAway: result.lambdaAway,
      markets: JSON.stringify(result.markets),
      topScores: JSON.stringify(result.topScores),
      bestMarket: result.best.key,
      bestProb: result.best.probability,
      confidence: confidenceFor(result.best, result.dataQuality, result.meta.disagreement, ai?.confidenceDelta ?? 0),
      dataQuality: result.dataQuality,
      meta: JSON.stringify(result.meta),
      summary: JSON.stringify(result.summary),
      modelVersion: result.modelVersion,
    };
    await prisma.prediction.upsert({ where: { matchId: m.id }, create: { matchId: m.id, ...data }, update: data });
    count++;
  }
  log.info(`${date}: ${count} predictions updated`);
  return count;
}

/** Settle combo selections and combos whose matches have concluded. */
export async function settleResults() {
  const now = Date.now();
  const pending = await prisma.comboSelection.findMany({
    where: { result: "PENDING", match: { status: { in: ["FINISHED", "CANCELLED", "POSTPONED"] } } },
    include: { match: true },
  });

  for (const s of pending) {
    const m = s.match;
    let result: "WON" | "LOST" | "VOID" | null = null;
    if (m.status === "FINISHED" && m.homeGoals !== null && m.awayGoals !== null) {
      result = settleMarket(s.market, m.homeGoals, m.awayGoals);
    } else if (m.status === "CANCELLED") {
      result = "VOID";
    } else if (m.status === "POSTPONED" && now - m.kickoff.getTime() > 48 * 3600 * 1000) {
      result = "VOID";
    }
    if (result) await prisma.comboSelection.update({ where: { id: s.id }, data: { result } });
  }

  const combos = await prisma.combo.findMany({ where: { status: "PENDING" }, include: { selections: true } });
  let settled = 0;
  for (const c of combos) {
    const results = c.selections.map((s) => s.result);
    let status: string | null = null;
    if (c.kind === "ACCA") {
      if (results.includes("LOST")) status = "LOST";
      else if (!results.includes("PENDING")) status = results.every((r) => r === "VOID") ? "VOID" : "WON";
    } else if (!results.includes("PENDING")) {
      status = "SETTLED";
    }
    if (status) {
      await prisma.combo.update({ where: { id: c.id }, data: { status } });
      settled++;
    }
  }
  if (pending.length || settled) log.info(`settled ${pending.length} selections, ${settled} combos`);
  return { selections: pending.length, combos: settled };
}
