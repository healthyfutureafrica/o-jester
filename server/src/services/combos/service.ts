import { env } from "../../config/env.js";
import { leagueTier } from "../../config/leagues.js";
import type { PlanId } from "../../config/plans.js";
import type { Lang } from "../../i18n/index.js";
import { zonedTimeToUtc } from "../../lib/dates.js";
import { createLogger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { parseJson } from "../../lib/util.js";
import type { MatchAnalysis } from "../ai/analyst.js";
import type { DataQuality, PredictionMeta } from "../predictions/engine.js";
import type { MarketProb } from "../predictions/markets.js";
import { comboView } from "../views.js";
import { buildDailyCombos, type Candidate, COMBO_TYPES } from "./builder.js";

const log = createLogger("combos");

/** Combos for a date are final from 09:00 local time (or once any leg kicks off). */
export const COMBO_LOCK_HOUR = 9;
export const comboLockTime = (date: string) => zonedTimeToUtc(date, COMBO_LOCK_HOUR, 0, env.APP_TIMEZONE);

/**
 * Generate (or regenerate) the day's combos. Combos that are already final are
 * kept untouched so users never see a slip change after they may have played it.
 */
export async function generateCombos(date: string, { now = new Date(), force = false }: { now?: Date; force?: boolean } = {}) {
  const lockAt = comboLockTime(date);
  const existing = await prisma.combo.findMany({
    where: { date },
    include: { selections: { include: { match: { select: { kickoff: true, status: true } } } } },
  });
  const isFinal = (c: (typeof existing)[number]) =>
    !force && (now >= lockAt || c.selections.some((s) => s.match.kickoff <= now));
  const keepTypes = new Set(existing.filter(isFinal).map((c) => c.type));
  if (keepTypes.size === COMBO_TYPES.length) return { created: 0, kept: keepTypes.size };

  const matches = await prisma.match.findMany({
    where: { matchDate: date, status: "SCHEDULED", prediction: { isNot: null } },
    include: { prediction: true },
  });
  const candidates: Candidate[] = matches.map((m) => {
    const p = m.prediction!;
    const ai = parseJson<MatchAnalysis | null>(p.aiAnalysis, null);
    return {
      matchId: m.id,
      leagueKey: m.leagueKey,
      leagueTier: leagueTier(m.leagueKey),
      kickoff: m.kickoff,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      markets: parseJson<MarketProb[]>(p.markets, []),
      dataQuality: p.dataQuality as DataQuality,
      disagreement: parseJson<PredictionMeta>(p.meta, { statsLambdas: null, marketLambdas: null, disagreement: 0 }).disagreement,
      ai: ai ? { stance: ai.stance, market: ai.market } : null,
    };
  });

  const built = buildDailyCombos(candidates, now).filter((c) => !keepTypes.has(c.type));
  await prisma.$transaction(async (tx) => {
    await tx.combo.deleteMany({ where: { date, type: { notIn: [...keepTypes] } } });
    for (const c of built) {
      await tx.combo.create({
        data: {
          date,
          type: c.type,
          minPlan: c.minPlan,
          kind: c.kind,
          title: c.title,
          description: c.description,
          totalOdds: c.totalOdds,
          probability: c.probability,
          oddsEstimated: c.oddsEstimated,
          selections: { create: c.selections.map((s, i) => ({ ...s, position: i })) },
        },
      });
    }
  });
  log.info(`${date}: ${built.length} combos generated, ${keepTypes.size} kept`);
  return { created: built.length, kept: keepTypes.size };
}

const PLAN_ORDER: Record<string, number> = { STARTER: 1, PRO: 2, ELITE: 3 };
const TYPE_ORDER = new Map(COMBO_TYPES.map((t, i) => [t.type as string, i]));

export async function listCombos(date: string, plan: PlanId | null, lang: Lang) {
  const combos = await prisma.combo.findMany({
    where: { date },
    include: { selections: { include: { match: true } } },
  });
  const lockAt = comboLockTime(date);
  return combos
    .sort((a, b) => PLAN_ORDER[a.minPlan] - PLAN_ORDER[b.minPlan] || (TYPE_ORDER.get(a.type) ?? 0) - (TYPE_ORDER.get(b.type) ?? 0))
    .map((c) => comboView(c, plan, lockAt, lang));
}
