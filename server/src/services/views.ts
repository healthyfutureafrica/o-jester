import type { Combo, ComboSelection, Match, Prediction } from "@prisma/client";
import { leagueTier } from "../config/leagues.js";
import { limitsFor, type PlanId, planAtLeast, planForLeagueTier } from "../config/plans.js";
import type { Lang, Localized } from "../i18n/index.js";
import { parseJson } from "../lib/util.js";
import type { MatchAnalysis } from "./ai/analyst.js";
import { comboText } from "./combos/builder.js";
import type { MatchStatsInput } from "./football/types.js";
import { confidenceFor, type DataQuality, pickBest, type PredictionMeta } from "./predictions/engine.js";
import { type MarketProb, marketLabel, marketShort, settleMarket } from "./predictions/markets.js";

/**
 * Serialisers that enforce plan entitlements and resolve text to the request
 * language. Everything a client receives goes through here, so locked data
 * never leaves the server.
 */

export type MatchWithPrediction = Match & { prediction: Prediction | null };

export interface MarketView {
  key: string;
  group: string;
  label: string;
  short: string;
  probability: number;
  fairOdds: number;
  bookOdds?: number;
  edge?: number;
  result?: "WON" | "LOST";
}

export interface ViewContext {
  plan: PlanId | null;
  lang: Lang;
  /** True when the date is beyond what the plan may see (early access). */
  earlyAccessLocked?: boolean;
}

function lockFor(m: Match, ctx: ViewContext): { locked: boolean; lockReason?: string; requiredPlan?: PlanId } {
  const tier = leagueTier(m.leagueKey);
  const required = planForLeagueTier(tier);
  if (!ctx.plan) return { locked: true, lockReason: "SUBSCRIBE", requiredPlan: required };
  if (ctx.earlyAccessLocked) return { locked: true, lockReason: "EARLY_ACCESS", requiredPlan: "ELITE" };
  if (limitsFor(ctx.plan).leagueTier < tier) return { locked: true, lockReason: "UPGRADE", requiredPlan: required };
  return { locked: false };
}

function marketView(m: MarketProb, match: Match, ctx: ViewContext): MarketView {
  const v: MarketView = {
    key: m.key,
    group: m.group,
    label: marketLabel(m.key, match.homeTeam, match.awayTeam, ctx.lang),
    short: marketShort(m.key, ctx.lang),
    probability: m.probability,
    fairOdds: m.fairOdds,
  };
  if (m.bookOdds) v.bookOdds = m.bookOdds;
  if (m.edge !== undefined && limitsFor(ctx.plan).valueEdges) v.edge = m.edge;
  if (match.status === "FINISHED" && match.homeGoals !== null && match.awayGoals !== null) {
    v.result = settleMarket(m.key, match.homeGoals, match.awayGoals);
  }
  return v;
}

function baseMatch(m: Match) {
  return {
    id: m.id,
    leagueKey: m.leagueKey,
    leagueName: m.leagueName,
    country: m.country,
    leagueTier: leagueTier(m.leagueKey),
    kickoff: m.kickoff.toISOString(),
    matchDate: m.matchDate,
    status: m.status,
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    homeLogo: m.homeLogo,
    awayLogo: m.awayLogo,
    homeGoals: m.homeGoals,
    awayGoals: m.awayGoals,
  };
}

function predictionCore(m: MatchWithPrediction, ctx: ViewContext) {
  const p = m.prediction!;
  const limits = limitsFor(ctx.plan);
  const markets = parseJson<MarketProb[]>(p.markets, []);
  const meta = parseJson<PredictionMeta>(p.meta, { statsLambdas: null, marketLambdas: null, disagreement: 0 });
  const ai = parseJson<MatchAnalysis | null>(p.aiAnalysis, null);
  const groups = limits.marketGroups.filter((g) => g !== "SCORE");
  const best = pickBest(markets, groups);
  const confidence = !best
    ? 0
    : best.key === p.bestMarket
      ? p.confidence
      : confidenceFor(best, p.dataQuality as DataQuality, meta.disagreement, ai?.confidenceDelta ?? 0);
  const prob = (k: string) => markets.find((x) => x.key === k)?.probability ?? 0;
  return {
    markets,
    ai,
    view: {
      bestPick: best ? marketView(best, m, ctx) : null,
      confidence,
      probs: { home: prob("1X2_H"), draw: prob("1X2_D"), away: prob("1X2_A") },
      xg: { home: p.lambdaHome, away: p.lambdaAway },
      dataQuality: p.dataQuality,
      aiStance: limits.aiAccess !== "none" && ai ? ai.stance : null,
    },
  };
}

export function matchListView(m: MatchWithPrediction, ctx: ViewContext) {
  const lock = lockFor(m, ctx);
  const base = { ...baseMatch(m), ...lock, hasPrediction: Boolean(m.prediction) };
  if (lock.locked || !m.prediction) return { ...base, prediction: null };
  return { ...base, prediction: predictionCore(m, ctx).view };
}

export function matchDetailView(m: MatchWithPrediction, ctx: ViewContext) {
  const lock = lockFor(m, ctx);
  const base = { ...baseMatch(m), ...lock, hasPrediction: Boolean(m.prediction) };
  if (lock.locked || !m.prediction) return { ...base, prediction: null };

  const limits = limitsFor(ctx.plan);
  const { markets, ai, view } = predictionCore(m, ctx);
  const visible = markets.filter((x) => limits.marketGroups.includes(x.group)).map((x) => marketView(x, m, ctx));
  const stats = parseJson<MatchStatsInput | null>(m.teamStats, null);
  const summary = parseJson<Localized | null>(m.prediction.summary, null);

  let aiView: Record<string, unknown> | null = null;
  if (ai && limits.aiAccess !== "none") {
    const text = ai[ctx.lang] ?? ai.en;
    const verdict = { stance: ai.stance, market: ai.market, label: marketLabel(ai.market, m.homeTeam, m.awayTeam, ctx.lang), reasoning: text.reasoning };
    const core = { headline: text.headline, summary: text.summary, keyFactors: text.keyFactors, verdict, generatedAt: ai.generatedAt };
    aiView =
      limits.aiAccess === "deep"
        ? { ...core, teamNews: text.teamNews, risks: text.risks, sources: ai.sources, confidenceDelta: ai.confidenceDelta }
        : core;
  }

  return {
    ...base,
    prediction: {
      ...view,
      summary: summary ? summary[ctx.lang] : "",
      markets: visible,
      topScores: limits.marketGroups.includes("SCORE") ? parseJson(m.prediction.topScores, []) : null,
      modelVersion: m.prediction.modelVersion,
      updatedAt: m.prediction.updatedAt.toISOString(),
      ai: aiView,
      aiLocked: limits.aiAccess === "none" ? "PRO" : limits.aiAccess === "summary" ? "ELITE" : null,
    },
    stats: stats && { home: stats.home, away: stats.away },
  };
}

export type ComboWithSelections = Combo & { selections: (ComboSelection & { match: Match })[] };

export function comboView(c: ComboWithSelections, plan: PlanId | null, lockAt: Date, lang: Lang, now = new Date()) {
  const locked = !planAtLeast(plan, c.minPlan as PlanId);
  const started = c.selections.some((s) => s.match.kickoff <= now);
  const text = comboText(c.type, lang);
  const base = {
    id: c.id,
    date: c.date,
    type: c.type,
    title: text?.title ?? c.title,
    description: text?.description ?? c.description,
    minPlan: c.minPlan,
    kind: c.kind,
    totalOdds: c.totalOdds,
    probability: c.probability,
    oddsEstimated: c.oddsEstimated,
    status: c.status,
    provisional: now < lockAt && !started,
    selectionsCount: c.selections.length,
    wonCount: c.selections.filter((s) => s.result === "WON").length,
    locked,
  };
  if (locked) return { ...base, selections: null };
  return {
    ...base,
    selections: [...c.selections]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        matchId: s.matchId,
        leagueName: s.match.leagueName,
        kickoff: s.match.kickoff.toISOString(),
        homeTeam: s.match.homeTeam,
        awayTeam: s.match.awayTeam,
        market: s.market,
        short: marketShort(s.market, lang),
        label: marketLabel(s.market, s.match.homeTeam, s.match.awayTeam, lang),
        odds: s.odds,
        probability: s.probability,
        oddsEstimated: s.oddsEstimated,
        result: s.result,
        matchStatus: s.match.status,
        score: s.match.homeGoals !== null && s.match.awayGoals !== null ? { home: s.match.homeGoals, away: s.match.awayGoals } : null,
      })),
  };
}
