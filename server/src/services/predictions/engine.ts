import type { MarketGroup } from "../../config/plans.js";
import type { Lang, Localized } from "../../i18n/index.js";
import { clamp, round } from "../../lib/util.js";
import type { BookOdds, LeagueContext, MatchStatsInput, TeamForm } from "../football/types.js";
import { BASE_MARKETS, type MarketProb, marketGroup } from "./markets.js";
import { fitLambdas, marketsFromMatrix, type MarketTarget, scoreMatrix, topScores } from "./poisson.js";

export const MODEL_VERSION = "oj-dixon-coles-1.0";

export type DataQuality = "HIGH" | "MEDIUM" | "LOW";

const DEFAULT_LEAGUE: LeagueContext = { avgHomeGoals: 1.5, avgAwayGoals: 1.2 };
/** Pseudo-games of league-average performance mixed into each team's ratings. */
const SHRINK_GAMES = 5;
/** Weight of the bookmaker-implied model when both sources are available. */
const MARKET_WEIGHT = 0.55;
/** Typical bookmaker margin applied to fair odds when real odds are missing. */
export const ESTIMATED_MARGIN = 0.93;

export interface PredictInput {
  homeTeam: string;
  awayTeam: string;
  stats: MatchStatsInput | null;
  odds: BookOdds | null;
}

export interface PredictionMeta {
  statsLambdas: { home: number; away: number } | null;
  marketLambdas: { home: number; away: number } | null;
  /** Mean absolute 1X2 probability gap between the stats model and the market (0..1). */
  disagreement: number;
}

export interface PredictionResult {
  lambdaHome: number;
  lambdaAway: number;
  markets: MarketProb[];
  topScores: { home: number; away: number; probability: number }[];
  dataQuality: DataQuality;
  best: MarketProb;
  confidence: number;
  summary: Localized;
  meta: PredictionMeta;
  modelVersion: string;
}

const shrink = (ratio: number, games: number) => (ratio * games + SHRINK_GAMES) / (games + SHRINK_GAMES);

export function formScore(form?: string): number | null {
  if (!form) return null;
  const recent = form.replace(/[^WDL]/gi, "").toUpperCase().slice(-5);
  if (recent.length < 3) return null;
  const pts = [...recent].reduce((s, r) => s + (r === "W" ? 3 : r === "D" ? 1 : 0), 0);
  return pts / (recent.length * 3);
}

/** Goal expectations from season attack/defence ratings relative to the league average. */
export function statsLambdas(stats: MatchStatsInput): { home: number; away: number } | null {
  const { home, away } = stats;
  if (!home || !away || home.played < 3 || away.played < 3) return null;
  const lg = stats.league && stats.league.avgHomeGoals > 0 && stats.league.avgAwayGoals > 0 ? stats.league : DEFAULT_LEAGUE;

  const split = (t: TeamForm, venue: "home" | "away") => {
    const n = venue === "home" ? t.homePlayed : t.awayPlayed;
    if (n >= 2) {
      return venue === "home"
        ? { gf: t.homeGf / n, ga: t.homeGa / n, n }
        : { gf: t.awayGf / n, ga: t.awayGa / n, n };
    }
    const adv = venue === "home" ? 1.1 : 0.9;
    return { gf: (t.gf / t.played) * adv, ga: (t.ga / t.played) / adv, n: t.played };
  };

  const h = split(home, "home");
  const a = split(away, "away");
  const attackHome = shrink(h.gf / lg.avgHomeGoals, h.n);
  const defenceAway = shrink(a.ga / lg.avgHomeGoals, a.n);
  const attackAway = shrink(a.gf / lg.avgAwayGoals, a.n);
  const defenceHome = shrink(h.ga / lg.avgAwayGoals, h.n);

  let lh = lg.avgHomeGoals * attackHome * defenceAway;
  let la = lg.avgAwayGoals * attackAway * defenceHome;

  const fh = formScore(home.form);
  const fa = formScore(away.form);
  if (fh !== null && fa !== null) {
    const d = fh - fa; // -1..1
    lh *= 1 + 0.12 * d;
    la *= 1 - 0.12 * d;
  }
  return { home: clamp(lh, 0.15, 4.5), away: clamp(la, 0.15, 4.5) };
}

/** Margin-free probabilities implied by bookmaker odds. */
export function impliedFromOdds(odds: BookOdds): MarketTarget | null {
  const h = odds["1X2_H"];
  const d = odds["1X2_D"];
  const a = odds["1X2_A"];
  if (!(h > 1 && d > 1 && a > 1)) return null;
  const sum = 1 / h + 1 / d + 1 / a;
  const target: MarketTarget = { home: 1 / h / sum, draw: 1 / d / sum, away: 1 / a / sum };
  const o = odds.OU25_O;
  const u = odds.OU25_U;
  if (o > 1 && u > 1) target.over25 = 1 / o / (1 / o + 1 / u);
  return target;
}

export function effectiveOdds(m: MarketProb): { odds: number; estimated: boolean } {
  if (m.bookOdds && m.bookOdds > 1) return { odds: m.bookOdds, estimated: false };
  return { odds: Math.max(1.01, round(m.fairOdds * ESTIMATED_MARGIN, 2)), estimated: true };
}

function makeMarket(key: string, probability: number, bookOdds?: number): MarketProb {
  const p = clamp(probability, 0.0001, 0.9999);
  const m: MarketProb = { key, group: marketGroup(key), probability: round(p, 4), fairOdds: round(Math.min(1 / p, 500), 2) };
  if (bookOdds && bookOdds > 1) {
    m.bookOdds = round(bookOdds, 2);
    m.edge = round(p * bookOdds - 1, 3);
  }
  return m;
}

/**
 * Headline pick: the most likely selection that still pays meaningful odds,
 * with a small bonus for positive expected value.
 */
export function pickBest(markets: MarketProb[], groups: MarketGroup[], minOdds = 1.3): MarketProb | null {
  const eligible = markets.filter((m) => groups.includes(m.group) && m.group !== "SCORE");
  if (!eligible.length) return null;
  const playable = eligible.filter((m) => effectiveOdds(m).odds >= minOdds);
  const pool = playable.length ? playable : eligible;
  const score = (m: MarketProb) => m.probability + 0.3 * Math.max(m.edge ?? 0, 0);
  return [...pool].sort((x, y) => score(y) - score(x))[0];
}

export function confidenceFor(pick: MarketProb, quality: DataQuality, disagreement = 0, aiDelta = 0): number {
  let c = pick.probability * 100;
  if (quality === "HIGH") c += 4;
  if (quality === "LOW") c -= 12;
  c -= disagreement * 50;
  c += aiDelta;
  return Math.round(clamp(c, 5, 97));
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

function buildSummary(lang: Lang, home: string, away: string, lh: number, la: number, probs: Record<string, number>): string {
  const fr = lang === "fr";
  const h = probs["1X2_H"];
  const d = probs["1X2_D"];
  const a = probs["1X2_A"];
  const num = (n: number) => (fr ? n.toFixed(2).replace(".", ",") : n.toFixed(2));
  const xg = fr ? `(buts attendus ${num(lh)} – ${num(la)}).` : `(expected goals ${num(lh)} – ${num(la)}).`;
  const parts: string[] = [];
  if (Math.abs(h - a) < 0.08) parts.push(fr ? `Match équilibré entre ${home} et ${away} ${xg}` : `An evenly matched contest between ${home} and ${away} ${xg}`);
  else if (h > a) parts.push(fr ? `${home} part favori à domicile face à ${away} ${xg}` : `${home} are favoured at home against ${away} ${xg}`);
  else parts.push(fr ? `${away} part favori à l'extérieur chez ${home} ${xg}` : `${away} are favoured on the road at ${home} ${xg}`);
  parts.push(
    fr
      ? `Modèle : ${pct(h)} victoire à domicile, ${pct(d)} nul, ${pct(a)} victoire à l'extérieur.`
      : `Model: ${pct(h)} home win, ${pct(d)} draw, ${pct(a)} away win.`,
  );
  if (probs.OU25_O >= 0.58) parts.push(fr ? `Des buts sont attendus — plus de 2,5 buts à ${pct(probs.OU25_O)}.` : `Goals are expected — Over 2.5 at ${pct(probs.OU25_O)}.`);
  else if (probs.OU25_U >= 0.58)
    parts.push(fr ? `Un match serré et fermé est probable — moins de 2,5 buts à ${pct(probs.OU25_U)}.` : `A tight, low-scoring game is likely — Under 2.5 at ${pct(probs.OU25_U)}.`);
  else parts.push(fr ? "La ligne des 2,5 buts est très équilibrée." : "The 2.5 goal line is finely balanced.");
  if (probs.BTTS_Y >= 0.58) parts.push(fr ? `Les deux équipes devraient marquer (${pct(probs.BTTS_Y)}).` : `Both teams to score looks likely (${pct(probs.BTTS_Y)}).`);
  return parts.join(" ");
}

export function predictMatch(input: PredictInput): PredictionResult {
  const odds = input.odds ?? {};
  const fromStats = input.stats ? statsLambdas(input.stats) : null;
  const target = input.odds ? impliedFromOdds(input.odds) : null;
  const fit = target ? fitLambdas(target) : null;
  const fromMarket = fit ? { home: fit.lambdaHome, away: fit.lambdaAway } : null;

  let lh: number;
  let la: number;
  let quality: DataQuality;
  if (fromStats && fromMarket) {
    lh = MARKET_WEIGHT * fromMarket.home + (1 - MARKET_WEIGHT) * fromStats.home;
    la = MARKET_WEIGHT * fromMarket.away + (1 - MARKET_WEIGHT) * fromStats.away;
    quality = "HIGH";
  } else if (fromMarket || fromStats) {
    ({ home: lh, away: la } = (fromMarket ?? fromStats)!);
    quality = "MEDIUM";
  } else {
    lh = 1.45;
    la = 1.15;
    quality = "LOW";
  }

  let disagreement = 0;
  if (fromStats && target) {
    const s = marketsFromMatrix(scoreMatrix(fromStats.home, fromStats.away));
    disagreement =
      (Math.abs(s["1X2_H"] - target.home) + Math.abs(s["1X2_D"] - target.draw) + Math.abs(s["1X2_A"] - target.away)) / 3;
  }

  const matrix = scoreMatrix(lh, la);
  const probs = marketsFromMatrix(matrix) as unknown as Record<string, number>;
  const scores = topScores(matrix, 6);

  const markets: MarketProb[] = BASE_MARKETS.map((key) => makeMarket(key, probs[key], odds[key]));
  for (const s of scores) {
    const key = `CS_${s.home}-${s.away}`;
    markets.push(makeMarket(key, s.probability, odds[key]));
  }

  const best = pickBest(markets, ["RESULT", "GOALS"])!;
  return {
    lambdaHome: round(lh, 3),
    lambdaAway: round(la, 3),
    markets,
    topScores: scores.map((s) => ({ ...s, probability: round(s.probability, 4) })),
    dataQuality: quality,
    best,
    confidence: confidenceFor(best, quality, disagreement),
    summary: {
      en: buildSummary("en", input.homeTeam, input.awayTeam, lh, la, probs),
      fr: buildSummary("fr", input.homeTeam, input.awayTeam, lh, la, probs),
    },
    meta: {
      statsLambdas: fromStats && { home: round(fromStats.home, 3), away: round(fromStats.away, 3) },
      marketLambdas: fromMarket && { home: round(fromMarket.home, 3), away: round(fromMarket.away, 3) },
      disagreement: round(disagreement, 4),
    },
    modelVersion: MODEL_VERSION,
  };
}
