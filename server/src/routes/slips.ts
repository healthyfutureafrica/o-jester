import type { Request } from "express";
import { Router } from "express";
import { z } from "zod";
import { leagueTier } from "../config/leagues.js";
import { limitsFor, PLANS } from "../config/plans.js";
import { msg } from "../i18n/index.js";
import { badRequest, forbidden, HttpError, tooMany, validate } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { parseJson, round } from "../lib/util.js";
import { requirePlan } from "../middleware/auth.js";
import { aiEnabled, type MatchAnalysis, reviewSlip } from "../services/ai/analyst.js";
import { effectiveOdds } from "../services/predictions/engine.js";
import { isMarketKey, type MarketProb, marketLabel, marketShort } from "../services/predictions/markets.js";

export const slipsRouter = Router();

const slipSchema = z.object({
  selections: z
    .array(z.object({ matchId: z.string().min(1), market: z.string().refine(isMarketKey, "validation.unknownMarket") }))
    .min(1, "validation.selectionsMin")
    .max(30),
});

/** Validate a user-built combination against the plan's entitlements and price it with the model. */
async function evaluate(req: Request, body: unknown) {
  const { selections } = validate(slipSchema, body);
  const lang = req.lang;
  const limits = limitsFor(req.auth!.plan);
  if (selections.length > limits.builderMaxPicks) {
    throw forbidden("slip.maxPicks", "PLAN_LIMIT", { requiredPlan: "ELITE" }, { n: limits.builderMaxPicks });
  }
  const ids = new Set(selections.map((s) => s.matchId));
  if (ids.size !== selections.length) throw badRequest("slip.onePerMatch");

  const matches = await prisma.match.findMany({ where: { id: { in: [...ids] } }, include: { prediction: true } });
  const byId = new Map(matches.map((m) => [m.id, m]));
  const now = new Date();
  const warnings: string[] = [];

  const legs = selections.map((s) => {
    const m = byId.get(s.matchId);
    if (!m?.prediction) throw badRequest("slip.noPrediction");
    const fixture = `${m.homeTeam} – ${m.awayTeam}`;
    if (leagueTier(m.leagueKey) > limits.leagueTier) throw forbidden("slip.leagueNotInPlan", "PLAN_LIMIT", undefined, { league: m.leagueName });
    const market = parseJson<MarketProb[]>(m.prediction.markets, []).find((x) => x.key === s.market);
    if (!market) throw badRequest("slip.marketUnavailable", { match: fixture });
    if (!limits.marketGroups.includes(market.group)) throw forbidden("slip.marketNotInPlan", "PLAN_LIMIT");
    if (m.status !== "SCHEDULED" || m.kickoff <= now) warnings.push(msg(lang, "slip.warnStarted", { match: fixture }));
    const ai = parseJson<MatchAnalysis | null>(m.prediction.aiAnalysis, null);
    if (ai?.stance === "AVOID") warnings.push(msg(lang, "slip.warnAvoid", { match: fixture }));
    const { odds, estimated } = effectiveOdds(market);
    return { match: m, market, odds, estimated, ai };
  });

  const totalOdds = legs.reduce((t, l) => t * l.odds, 1);
  const probability = legs.reduce((t, l) => t * l.market.probability, 1);
  if (legs.length >= 6 && probability < 0.05) warnings.push(msg(lang, "slip.warnLong"));

  return {
    legs,
    view: {
      selections: legs.map((l) => ({
        matchId: l.match.id,
        leagueName: l.match.leagueName,
        kickoff: l.match.kickoff.toISOString(),
        homeTeam: l.match.homeTeam,
        awayTeam: l.match.awayTeam,
        market: l.market.key,
        short: marketShort(l.market.key, lang),
        label: marketLabel(l.market.key, l.match.homeTeam, l.match.awayTeam, lang),
        odds: round(l.odds, 2),
        oddsEstimated: l.estimated,
        probability: l.market.probability,
        edge: limits.valueEdges ? (l.market.edge ?? null) : null,
      })),
      totalOdds: round(totalOdds, 2),
      probability: round(probability, 4),
      oddsEstimated: legs.some((l) => l.estimated),
      warnings,
    },
  };
}

slipsRouter.post("/slips/evaluate", requirePlan("PRO"), async (req, res) => {
  const { view } = await evaluate(req, req.body);
  res.json(view);
});

slipsRouter.post("/slips/review", requirePlan("ELITE"), async (req, res) => {
  if (!aiEnabled) throw new HttpError(503, "slip.aiDisabled", "AI_DISABLED");
  const user = req.auth!.user;
  const perDay = PLANS.ELITE.limits.slipReviewsPerDay;
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const used = await prisma.aiUsage.count({ where: { userId: user.id, kind: "SLIP_REVIEW", createdAt: { gte: since } } });
  if (used >= perDay) throw tooMany("slip.reviewLimit", { n: perDay });

  const { legs, view } = await evaluate(req, req.body);
  const review = await reviewSlip(
    legs.map((l) => ({
      matchId: l.match.id,
      fixture: `${l.match.homeTeam} v ${l.match.awayTeam}`,
      competition: l.match.leagueName,
      kickoff: l.match.kickoff.toISOString(),
      market: l.market.key,
      selection: marketLabel(l.market.key, l.match.homeTeam, l.match.awayTeam),
      modelProbability: Math.round(l.market.probability * 1000) / 10,
      odds: round(l.odds, 2),
      aiStance: l.ai?.stance,
      teamNews: l.ai?.en.teamNews,
      risks: l.ai?.en.risks,
    })),
    { odds: view.totalOdds, probability: view.probability },
    req.lang,
  );
  if (!review) throw new HttpError(502, "slip.aiUnavailable", "AI_UNAVAILABLE");
  await prisma.aiUsage.create({ data: { userId: user.id, kind: "SLIP_REVIEW" } });
  res.json({ ...view, review, reviewsLeft: perDay - used - 1 });
});
