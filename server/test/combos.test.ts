import { describe, expect, it } from "vitest";
import { buildDailyCombos, type Candidate } from "../src/services/combos/builder.js";
import { predictMatch } from "../src/services/predictions/engine.js";
import { marketsFromMatrix, scoreMatrix, topScores } from "../src/services/predictions/poisson.js";

const NOW = new Date("2026-10-24T08:00:00Z");

function oddsFor(lh: number, la: number) {
  const m = scoreMatrix(lh, la);
  const p = marketsFromMatrix(m) as unknown as Record<string, number>;
  const odds: Record<string, number> = {};
  // Price slightly generously so some value edges exist.
  for (const [k, v] of Object.entries(p)) odds[k] = Math.round((1.02 / v) * 100) / 100;
  for (const s of topScores(m, 8)) odds[`CS_${s.home}-${s.away}`] = Math.round((0.9 / s.probability) * 100) / 100;
  return odds;
}

function candidate(i: number, league: string, tier: number, lh: number, la: number): Candidate {
  const r = predictMatch({ homeTeam: `Home ${i}`, awayTeam: `Away ${i}`, stats: null, odds: oddsFor(lh, la) });
  return {
    matchId: `m${i}`,
    leagueKey: league,
    leagueTier: tier,
    kickoff: new Date(NOW.getTime() + (i + 2) * 3600 * 1000),
    homeTeam: `Home ${i}`,
    awayTeam: `Away ${i}`,
    markets: r.markets,
    dataQuality: r.dataQuality,
    disagreement: 0,
  };
}

const slate: Candidate[] = [
  candidate(1, "eng-pl", 1, 2.4, 0.6),
  candidate(2, "esp-laliga", 1, 2.2, 0.8),
  candidate(3, "ita-seriea", 1, 1.9, 0.9),
  candidate(4, "ger-bundesliga", 1, 2.1, 1.4),
  candidate(5, "fra-ligue1", 1, 0.7, 1.9),
  candidate(6, "uefa-uel", 2, 1.9, 1.6),
  candidate(7, "ned-eredivisie", 2, 2.3, 1.5),
  candidate(8, "tur-superlig", 2, 1.8, 1.7),
  candidate(9, "egy-premier", 3, 1.6, 0.7),
  candidate(10, "mar-botola", 3, 1.5, 0.8),
  candidate(11, "por-primeira", 2, 2.6, 0.5),
];

describe("combo builder", () => {
  const combos = buildDailyCombos(slate, NOW);
  const byType = Object.fromEntries(combos.map((c) => [c.type, c]));

  it("builds starter combos only from tier-1 leagues", () => {
    for (const type of ["SAFE_DOUBLE", "DAILY_TREBLE"]) {
      const c = byType[type];
      expect(c, type).toBeDefined();
      for (const s of c.selections) expect(slate.find((x) => x.matchId === s.matchId)!.leagueTier).toBe(1);
    }
    expect(byType.SAFE_DOUBLE.selections).toHaveLength(2);
    expect(byType.DAILY_TREBLE.selections).toHaveLength(3);
  });

  it("never uses the same match twice in a combo and multiplies odds", () => {
    for (const c of combos) {
      const ids = c.selections.map((s) => s.matchId);
      expect(new Set(ids).size).toBe(ids.length);
      if (c.kind === "ACCA") {
        const product = c.selections.reduce((t, s) => t * s.odds, 1);
        expect(c.totalOdds).toBeCloseTo(product, 1);
        const prob = c.selections.reduce((t, s) => t * s.probability, 1);
        expect(c.probability).toBeCloseTo(prob, 3);
      }
    }
  });

  it("builds goals and BTTS combos from goals markets only", () => {
    expect(byType.GOALS_GALORE.selections.every((s) => s.market.startsWith("OU"))).toBe(true);
    expect(byType.BTTS_SPECIAL?.selections.every((s) => s.market === "BTTS_Y") ?? true).toBe(true);
  });

  it("only uses real bookmaker prices with positive edge in value combos", () => {
    for (const s of byType.VALUE_FOUR?.selections ?? []) expect(s.oddsEstimated).toBe(false);
  });

  it("excludes matches flagged AVOID and matches about to start", () => {
    const flagged = slate.map((c) => (c.matchId === "m1" ? { ...c, ai: { stance: "AVOID" as const, market: "1X2_H" } } : c));
    const started = flagged.map((c) => (c.matchId === "m2" ? { ...c, kickoff: new Date(NOW.getTime() + 5 * 60000) } : c));
    const out = buildDailyCombos(started, NOW);
    const used = out.flatMap((c) => c.selections.map((s) => s.matchId));
    expect(used).not.toContain("m1");
    expect(used).not.toContain("m2");
  });

  it("returns nothing for an empty slate", () => {
    expect(buildDailyCombos([], NOW)).toEqual([]);
  });
});
