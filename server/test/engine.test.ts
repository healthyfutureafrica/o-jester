import { describe, expect, it } from "vitest";
import { confidenceFor, effectiveOdds, formScore, impliedFromOdds, pickBest, predictMatch, statsLambdas } from "../src/services/predictions/engine.js";
import { isMarketKey, marketLabel, marketShort, settleMarket } from "../src/services/predictions/markets.js";
import { fitLambdas, marketsFromMatrix, scoreMatrix } from "../src/services/predictions/poisson.js";

const strongTeam = { played: 10, gf: 25, ga: 6, homePlayed: 5, homeGf: 15, homeGa: 2, awayPlayed: 5, awayGf: 10, awayGa: 4, form: "WWWDW" };
const weakTeam = { played: 10, gf: 8, ga: 20, homePlayed: 5, homeGf: 5, homeGa: 9, awayPlayed: 5, awayGf: 3, awayGa: 11, form: "LLDLL" };

describe("poisson model", () => {
  it("produces a normalised score matrix", () => {
    const m = scoreMatrix(1.6, 1.1);
    const total = m.flat().reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 9);
  });

  it("produces consistent market probabilities", () => {
    const p = marketsFromMatrix(scoreMatrix(1.6, 1.1));
    expect(p["1X2_H"] + p["1X2_D"] + p["1X2_A"]).toBeCloseTo(1, 9);
    expect(p.DC_1X).toBeCloseTo(p["1X2_H"] + p["1X2_D"], 9);
    expect(p.OU25_O + p.OU25_U).toBeCloseTo(1, 9);
    expect(p.OU15_O).toBeGreaterThan(p.OU25_O);
    expect(p.OU25_O).toBeGreaterThan(p.OU35_O);
    expect(p["1X2_H"]).toBeGreaterThan(p["1X2_A"]);
  });

  it("recovers goal expectations from market probabilities", () => {
    const truth = marketsFromMatrix(scoreMatrix(1.8, 0.9, 0));
    const fit = fitLambdas({ home: truth["1X2_H"], draw: truth["1X2_D"], away: truth["1X2_A"], over25: truth.OU25_O });
    expect(fit.lambdaHome).toBeCloseTo(1.8, 1);
    expect(fit.lambdaAway).toBeCloseTo(0.9, 1);
  });
});

describe("engine", () => {
  it("removes bookmaker margin from implied probabilities", () => {
    const t = impliedFromOdds({ "1X2_H": 2.0, "1X2_D": 3.4, "1X2_A": 3.8 })!;
    expect(t.home + t.draw + t.away).toBeCloseTo(1, 9);
    expect(impliedFromOdds({ "1X2_H": 2.0 })).toBeNull();
  });

  it("rates a strong home side above a weak away side", () => {
    const l = statsLambdas({ home: strongTeam, away: weakTeam, league: { avgHomeGoals: 1.5, avgAwayGoals: 1.2 } })!;
    expect(l.home).toBeGreaterThan(l.away * 2);
  });

  it("scores form strings", () => {
    expect(formScore("WWWWW")).toBe(1);
    expect(formScore("LLLLL")).toBe(0);
    expect(formScore("W")).toBeNull();
  });

  it("predicts with HIGH quality when stats and odds are present", () => {
    const r = predictMatch({
      homeTeam: "Strong FC",
      awayTeam: "Weak United",
      stats: { home: strongTeam, away: weakTeam, league: { avgHomeGoals: 1.5, avgAwayGoals: 1.2 } },
      odds: { "1X2_H": 1.45, "1X2_D": 4.5, "1X2_A": 7.5, OU25_O: 1.7, OU25_U: 2.15 },
    });
    expect(r.dataQuality).toBe("HIGH");
    expect(r.lambdaHome).toBeGreaterThan(r.lambdaAway);
    const home = r.markets.find((m) => m.key === "1X2_H")!;
    expect(home.probability).toBeGreaterThan(0.5);
    expect(home.bookOdds).toBe(1.45);
    expect(home.edge).toBeCloseTo(home.probability * 1.45 - 1, 2);
    expect(r.markets.some((m) => m.key.startsWith("CS_"))).toBe(true);
    expect(r.confidence).toBeGreaterThan(40);
    expect(r.summary.en).toContain("Strong FC");
    expect(r.summary.fr).toContain("Strong FC");
    expect(r.summary.fr).toContain("Modèle");
  });

  it("falls back to LOW quality with no data", () => {
    const r = predictMatch({ homeTeam: "A", awayTeam: "B", stats: null, odds: null });
    expect(r.dataQuality).toBe("LOW");
    expect(r.markets.every((m) => m.bookOdds === undefined)).toBe(true);
  });

  it("picks a playable best pick restricted to allowed groups", () => {
    const r = predictMatch({ homeTeam: "A", awayTeam: "B", stats: null, odds: { "1X2_H": 1.9, "1X2_D": 3.5, "1X2_A": 4.2 } });
    const resultOnly = pickBest(r.markets, ["RESULT"])!;
    expect(resultOnly.group).toBe("RESULT");
    expect(effectiveOdds(resultOnly).odds).toBeGreaterThanOrEqual(1.3);
    expect(pickBest(r.markets, [])).toBeNull();
  });

  it("penalises low data quality and disagreement in confidence", () => {
    const pick = { key: "1X2_H", group: "RESULT" as const, probability: 0.6, fairOdds: 1.67 };
    expect(confidenceFor(pick, "HIGH")).toBeGreaterThan(confidenceFor(pick, "LOW"));
    expect(confidenceFor(pick, "HIGH", 0.1)).toBeLessThan(confidenceFor(pick, "HIGH", 0));
    expect(confidenceFor(pick, "HIGH", 0, 10)).toBe(confidenceFor(pick, "HIGH") + 10);
  });
});

describe("markets", () => {
  it("settles every market correctly", () => {
    expect(settleMarket("1X2_H", 2, 1)).toBe("WON");
    expect(settleMarket("1X2_D", 1, 1)).toBe("WON");
    expect(settleMarket("1X2_A", 2, 1)).toBe("LOST");
    expect(settleMarket("DC_1X", 1, 1)).toBe("WON");
    expect(settleMarket("DC_12", 0, 0)).toBe("LOST");
    expect(settleMarket("DC_X2", 0, 1)).toBe("WON");
    expect(settleMarket("OU25_O", 2, 1)).toBe("WON");
    expect(settleMarket("OU25_O", 1, 1)).toBe("LOST");
    expect(settleMarket("OU15_U", 1, 0)).toBe("WON");
    expect(settleMarket("OU35_U", 2, 2)).toBe("LOST");
    expect(settleMarket("BTTS_Y", 1, 1)).toBe("WON");
    expect(settleMarket("BTTS_N", 3, 0)).toBe("WON");
    expect(settleMarket("CS_2-1", 2, 1)).toBe("WON");
    expect(settleMarket("CS_2-1", 1, 2)).toBe("LOST");
  });

  it("labels selections", () => {
    expect(marketShort("DC_X2")).toBe("X2");
    expect(marketShort("OU25_O")).toBe("Over 2.5");
    expect(marketShort("CS_1-0")).toBe("CS 1-0");
    expect(marketLabel("1X2_H", "Arsenal", "Chelsea")).toBe("Arsenal to win");
    expect(isMarketKey("CS_3-2")).toBe(true);
    expect(isMarketKey("OU45_O")).toBe(false);
  });

  it("labels selections in French", () => {
    expect(marketLabel("1X2_H", "Coton Sport", "Canon", "fr")).toBe("Victoire Coton Sport");
    expect(marketLabel("DC_X2", "Coton Sport", "Canon", "fr")).toBe("Canon ou nul");
    expect(marketLabel("OU25_O", "A", "B", "fr")).toBe("Plus de 2,5 buts");
    expect(marketLabel("BTTS_Y", "A", "B", "fr")).toBe("Les deux équipes marquent — Oui");
    expect(marketShort("OU15_U", "fr")).toBe("Moins 1.5");
    expect(marketShort("CS_2-1", "fr")).toBe("SE 2-1");
  });
});
