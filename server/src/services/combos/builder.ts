import type { MarketGroup, PlanId } from "../../config/plans.js";
import type { Lang, Localized } from "../../i18n/index.js";
import { round } from "../../lib/util.js";
import { type DataQuality, effectiveOdds } from "../predictions/engine.js";
import { type MarketProb, marketLabel } from "../predictions/markets.js";

export type ComboKind = "ACCA" | "SINGLES";
export type AiStance = "BACK" | "LEAN" | "AVOID";

export interface Candidate {
  matchId: string;
  leagueKey: string;
  leagueTier: number;
  kickoff: Date;
  homeTeam: string;
  awayTeam: string;
  markets: MarketProb[];
  dataQuality: DataQuality;
  disagreement: number;
  ai?: { stance: AiStance; market: string } | null;
}

export interface BuiltSelection {
  matchId: string;
  market: string;
  label: string;
  odds: number;
  probability: number;
  oddsEstimated: boolean;
}

export interface BuiltCombo {
  type: ComboType;
  title: string;
  description: string;
  minPlan: PlanId;
  kind: ComboKind;
  selections: BuiltSelection[];
  totalOdds: number;
  probability: number;
  oddsEstimated: boolean;
}

export type ComboType =
  | "SAFE_DOUBLE"
  | "DAILY_TREBLE"
  | "GOALS_GALORE"
  | "BTTS_SPECIAL"
  | "VALUE_FOUR"
  | "ELITE_BANKER"
  | "MEGA_ACCA"
  | "VALUE_FIVE"
  | "CORRECT_SCORE";

export interface ComboTypeDef {
  type: ComboType;
  title: Localized;
  description: Localized;
  minPlan: PlanId;
  kind: ComboKind;
  leagueTier: 1 | 2 | 3;
}

export const COMBO_TYPES: ComboTypeDef[] = [
  {
    type: "SAFE_DOUBLE",
    title: { en: "Safe Double", fr: "Double Sûr" },
    description: { en: "The two highest-probability result picks of the day.", fr: "Les deux pronostics de résultat les plus probables du jour." },
    minPlan: "STARTER",
    kind: "ACCA",
    leagueTier: 1,
  },
  {
    type: "DAILY_TREBLE",
    title: { en: "Daily Treble", fr: "Triple du Jour" },
    description: { en: "Three strong result picks for a better return.", fr: "Trois pronostics de résultat solides pour une meilleure cote." },
    minPlan: "STARTER",
    kind: "ACCA",
    leagueTier: 1,
  },
  {
    type: "GOALS_GALORE",
    title: { en: "Goals Galore", fr: "Festival de Buts" },
    description: { en: "Over-goals selections from the most attacking fixtures.", fr: "Sélections « plus de buts » sur les matchs les plus offensifs." },
    minPlan: "PRO",
    kind: "ACCA",
    leagueTier: 2,
  },
  {
    type: "BTTS_SPECIAL",
    title: { en: "BTTS Special", fr: "Spécial GG" },
    description: { en: "Matches where both teams are most likely to score.", fr: "Les matchs où les deux équipes ont le plus de chances de marquer." },
    minPlan: "PRO",
    kind: "ACCA",
    leagueTier: 2,
  },
  {
    type: "VALUE_FOUR",
    title: { en: "Value Four", fr: "Quatre Value" },
    description: { en: "Four picks where our model beats the bookmaker's price.", fr: "Quatre pronostics où notre modèle bat la cote du bookmaker." },
    minPlan: "PRO",
    kind: "ACCA",
    leagueTier: 2,
  },
  {
    type: "ELITE_BANKER",
    title: { en: "Elite Banker", fr: "Banker Élite" },
    description: { en: "The single most reliable selection on today's card.", fr: "La sélection la plus fiable du programme du jour." },
    minPlan: "ELITE",
    kind: "SINGLES",
    leagueTier: 3,
  },
  {
    type: "MEGA_ACCA",
    title: { en: "Mega Accumulator", fr: "Méga Combiné" },
    description: { en: "High-odds accumulator built from solid, AI-vetted picks.", fr: "Combiné à grosse cote construit à partir de pronostics solides validés par l'IA." },
    minPlan: "ELITE",
    kind: "ACCA",
    leagueTier: 3,
  },
  {
    type: "VALUE_FIVE",
    title: { en: "Value Five", fr: "Cinq Value" },
    description: { en: "Five positive-expected-value picks across all markets.", fr: "Cinq pronostics à espérance positive sur tous les marchés." },
    minPlan: "ELITE",
    kind: "ACCA",
    leagueTier: 3,
  },
  {
    type: "CORRECT_SCORE",
    title: { en: "Correct Score Picks", fr: "Scores Exacts" },
    description: { en: "The most likely exact scores — play as singles.", fr: "Les scores exacts les plus probables — à jouer en simple." },
    minPlan: "ELITE",
    kind: "SINGLES",
    leagueTier: 3,
  },
];

export function comboText(type: string, lang: Lang): { title: string; description: string } | null {
  const def = COMBO_TYPES.find((d) => d.type === type);
  return def ? { title: def.title[lang], description: def.description[lang] } : null;
}

interface Pick {
  cand: Candidate;
  market: MarketProb;
  odds: number;
  estimated: boolean;
  score: number;
}

type Accept = (m: MarketProb, odds: number, estimated: boolean) => boolean;
type Score = (m: MarketProb, odds: number) => number;

const qualityFactor = (c: Candidate) =>
  (c.dataQuality === "HIGH" ? 1 : c.dataQuality === "MEDIUM" ? 0.97 : 0.85) - Math.min(c.disagreement, 0.3) * 0.5;

const aiFactor = (c: Candidate, m: MarketProb) => {
  if (!c.ai || c.ai.market !== m.key) return 1;
  return c.ai.stance === "BACK" ? 1.05 : c.ai.stance === "LEAN" ? 1.02 : 1;
};

function bestPickFor(c: Candidate, groups: MarketGroup[], accept: Accept, score: Score): Pick | null {
  let best: Pick | null = null;
  for (const m of c.markets) {
    if (!groups.includes(m.group)) continue;
    const { odds, estimated } = effectiveOdds(m);
    if (!accept(m, odds, estimated)) continue;
    const s = score(m, odds) * qualityFactor(c) * aiFactor(c, m);
    if (!best || s > best.score) best = { cand: c, market: m, odds, estimated, score: s };
  }
  return best;
}

interface AssembleOptions {
  groups: MarketGroup[];
  accept: Accept;
  score?: Score;
  count: number;
  maxPerLeague?: number;
  avoid?: Set<string>;
  /** Stop adding picks once the accumulated odds reach this value. */
  targetOdds?: number;
}

function assemble(cands: Candidate[], o: AssembleOptions): Pick[] {
  const score = o.score ?? ((m) => m.probability);
  const ranked = cands
    .map((c) => bestPickFor(c, o.groups, o.accept, score))
    .filter((p): p is Pick => p !== null)
    .sort((a, b) => b.score - a.score);
  // Prefer matches not already used by sibling combos, then fall back to them.
  const ordered = o.avoid
    ? [...ranked.filter((p) => !o.avoid!.has(p.cand.matchId)), ...ranked.filter((p) => o.avoid!.has(p.cand.matchId))]
    : ranked;

  const chosen: Pick[] = [];
  const perLeague = new Map<string, number>();
  let odds = 1;
  for (const p of ordered) {
    if (chosen.length >= o.count) break;
    if (o.targetOdds && odds >= o.targetOdds && chosen.length >= 3) break;
    const n = perLeague.get(p.cand.leagueKey) ?? 0;
    if (o.maxPerLeague && n >= o.maxPerLeague) continue;
    chosen.push(p);
    perLeague.set(p.cand.leagueKey, n + 1);
    odds *= p.odds;
  }
  return chosen.sort((a, b) => a.cand.kickoff.getTime() - b.cand.kickoff.getTime());
}

function toCombo(def: ComboTypeDef, picks: Pick[]): BuiltCombo {
  const selections = picks.map<BuiltSelection>((p) => ({
    matchId: p.cand.matchId,
    market: p.market.key,
    label: marketLabel(p.market.key, p.cand.homeTeam, p.cand.awayTeam),
    odds: round(p.odds, 2),
    probability: p.market.probability,
    oddsEstimated: p.estimated,
  }));
  const acca = def.kind === "ACCA";
  const totalOdds = acca
    ? selections.reduce((t, s) => t * s.odds, 1)
    : selections.reduce((t, s) => t + s.odds, 0) / selections.length;
  const probability = acca
    ? selections.reduce((t, s) => t * s.probability, 1)
    : selections.reduce((t, s) => t + s.probability, 0) / selections.length;
  return {
    type: def.type,
    title: def.title.en,
    description: def.description.en,
    minPlan: def.minPlan,
    kind: def.kind,
    selections,
    totalOdds: round(totalOdds, 2),
    probability: round(probability, 4),
    oddsEstimated: selections.some((s) => s.oddsEstimated),
  };
}

const def = (t: ComboType) => COMBO_TYPES.find((d) => d.type === t)!;

/**
 * Build the day's combinations from predicted fixtures.
 * Assumes selections are independent (one pick per match) when combining probabilities.
 */
export function buildDailyCombos(candidates: Candidate[], now: Date = new Date()): BuiltCombo[] {
  const cutoff = now.getTime() + 10 * 60 * 1000;
  const pool = candidates.filter((c) => c.kickoff.getTime() > cutoff && c.ai?.stance !== "AVOID");
  const tier = (t: number) => pool.filter((c) => c.leagueTier <= t);
  const RESULT: MarketGroup[] = ["RESULT"];
  const PLAYABLE: MarketGroup[] = ["RESULT", "GOALS"];
  const out: BuiltCombo[] = [];
  const add = (type: ComboType, picks: Pick[], min: number) => {
    if (picks.length >= min) out.push(toCombo(def(type), picks));
    return picks;
  };
  const used = new Set<string>();
  const markUsed = (picks: Pick[]) => picks.forEach((p) => used.add(p.cand.matchId));

  // Starter
  markUsed(
    add(
      "SAFE_DOUBLE",
      assemble(tier(1), { groups: RESULT, accept: (m, o) => o >= 1.2 && o <= 1.8, count: 2, maxPerLeague: 1 }),
      2,
    ),
  );
  markUsed(
    add(
      "DAILY_TREBLE",
      assemble(tier(1), { groups: RESULT, accept: (m, o) => o >= 1.3 && o <= 2.3, count: 3, maxPerLeague: 2, avoid: used }),
      3,
    ),
  );

  // Pro
  add(
    "GOALS_GALORE",
    assemble(tier(2), {
      groups: ["GOALS"],
      accept: (m, o) => (m.key === "OU25_O" && m.probability >= 0.56) || (m.key === "OU15_O" && m.probability >= 0.76 && o >= 1.15),
      score: (m) => m.probability * (m.key === "OU25_O" ? 1.12 : 1),
      count: 4,
      maxPerLeague: 2,
    }),
    3,
  );
  add(
    "BTTS_SPECIAL",
    assemble(tier(2), { groups: ["GOALS"], accept: (m) => m.key === "BTTS_Y" && m.probability >= 0.54, count: 3, maxPerLeague: 2 }),
    3,
  );
  add(
    "VALUE_FOUR",
    assemble(tier(2), {
      groups: PLAYABLE,
      accept: (m, o, est) => !est && (m.edge ?? 0) >= 0.03 && m.probability >= 0.42,
      score: (m) => m.probability * (1 + (m.edge ?? 0)),
      count: 4,
      maxPerLeague: 2,
    }),
    3,
  );

  // Elite
  add("ELITE_BANKER", assemble(tier(3), { groups: PLAYABLE, accept: (m, o) => o >= 1.3, count: 1 }), 1);
  add(
    "MEGA_ACCA",
    assemble(tier(3), {
      groups: PLAYABLE,
      accept: (m, o) => m.probability >= 0.6 && o >= 1.25,
      count: 8,
      maxPerLeague: 2,
      targetOdds: 10,
    }),
    5,
  );
  add(
    "VALUE_FIVE",
    assemble(tier(3), {
      groups: PLAYABLE,
      accept: (m, o, est) => !est && (m.edge ?? 0) >= 0.02 && m.probability >= 0.38,
      score: (m) => m.probability * (1 + (m.edge ?? 0)),
      count: 5,
      maxPerLeague: 2,
    }),
    4,
  );
  add("CORRECT_SCORE", assemble(tier(3), { groups: ["SCORE"], accept: () => true, count: 3 }), 2);

  return out;
}
