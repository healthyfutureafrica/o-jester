import type { MarketGroup } from "../../config/plans.js";
import type { Lang } from "../../i18n/index.js";

/**
 * Market keys:
 *   1X2_H | 1X2_D | 1X2_A                 match result
 *   DC_1X | DC_12 | DC_X2                 double chance
 *   OU15_O | OU15_U | OU25_O | ... OU35_U over/under goals
 *   BTTS_Y | BTTS_N                       both teams to score
 *   CS_<h>-<a>                            correct score, e.g. CS_2-1
 * All markets settle on the 90-minute score.
 */
export const BASE_MARKETS = [
  "1X2_H",
  "1X2_D",
  "1X2_A",
  "DC_1X",
  "DC_12",
  "DC_X2",
  "OU15_O",
  "OU15_U",
  "OU25_O",
  "OU25_U",
  "OU35_O",
  "OU35_U",
  "BTTS_Y",
  "BTTS_N",
] as const;

export interface MarketProb {
  key: string;
  group: MarketGroup;
  probability: number;
  fairOdds: number;
  bookOdds?: number;
  /** Expected value of a 1-unit stake at bookmaker odds: p * odds - 1. */
  edge?: number;
}

export type SelectionResult = "WON" | "LOST" | "VOID" | "PENDING";

const CS_RE = /^CS_(\d+)-(\d+)$/;

export function isMarketKey(key: string): boolean {
  return (BASE_MARKETS as readonly string[]).includes(key) || CS_RE.test(key);
}

export function marketGroup(key: string): MarketGroup {
  if (key.startsWith("1X2_") || key.startsWith("DC_")) return "RESULT";
  if (key.startsWith("CS_")) return "SCORE";
  return "GOALS";
}

function ouLine(key: string): number {
  return Number(key.slice(2, 4)) / 10; // "OU25_O" -> 2.5
}

/** Short betting-slip notation, e.g. "1", "X2", "Over 2.5" / "Plus 2.5", "GG", "CS 2-1". */
export function marketShort(key: string, lang: Lang = "en"): string {
  const cs = CS_RE.exec(key);
  if (cs) return `${lang === "fr" ? "SE" : "CS"} ${cs[1]}-${cs[2]}`;
  const fixed: Record<string, string> = { "1X2_H": "1", "1X2_D": "X", "1X2_A": "2", DC_1X: "1X", DC_12: "12", DC_X2: "X2", BTTS_Y: "GG", BTTS_N: "NG" };
  if (fixed[key]) return fixed[key];
  if (key.startsWith("OU")) {
    const over = key.endsWith("_O");
    return lang === "fr" ? `${over ? "Plus" : "Moins"} ${ouLine(key)}` : `${over ? "Over" : "Under"} ${ouLine(key)}`;
  }
  return key;
}

/** Human-readable label for a market selection in the context of a fixture. */
export function marketLabel(key: string, home: string, away: string, lang: Lang = "en"): string {
  const fr = lang === "fr";
  const cs = CS_RE.exec(key);
  if (cs) return fr ? `Score exact ${cs[1]}-${cs[2]}` : `Correct score ${cs[1]}-${cs[2]}`;
  switch (key) {
    case "1X2_H":
      return fr ? `Victoire ${home}` : `${home} to win`;
    case "1X2_D":
      return fr ? "Match nul" : "Draw";
    case "1X2_A":
      return fr ? `Victoire ${away}` : `${away} to win`;
    case "DC_1X":
      return fr ? `${home} ou nul` : `${home} or draw`;
    case "DC_12":
      return fr ? `${home} ou ${away} (pas de nul)` : `${home} or ${away} (no draw)`;
    case "DC_X2":
      return fr ? `${away} ou nul` : `${away} or draw`;
    case "BTTS_Y":
      return fr ? "Les deux équipes marquent — Oui" : "Both teams to score — Yes";
    case "BTTS_N":
      return fr ? "Les deux équipes marquent — Non" : "Both teams to score — No";
  }
  if (key.startsWith("OU")) {
    const line = fr ? String(ouLine(key)).replace(".", ",") : String(ouLine(key));
    const over = key.endsWith("_O");
    return fr ? `${over ? "Plus" : "Moins"} de ${line} buts` : `${over ? "Over" : "Under"} ${line} goals`;
  }
  return key;
}

/** Settle a market against a 90-minute final score. */
export function settleMarket(key: string, home: number, away: number): "WON" | "LOST" {
  const won = (() => {
    const cs = CS_RE.exec(key);
    if (cs) return Number(cs[1]) === home && Number(cs[2]) === away;
    const total = home + away;
    switch (key) {
      case "1X2_H":
        return home > away;
      case "1X2_D":
        return home === away;
      case "1X2_A":
        return away > home;
      case "DC_1X":
        return home >= away;
      case "DC_12":
        return home !== away;
      case "DC_X2":
        return away >= home;
      case "BTTS_Y":
        return home > 0 && away > 0;
      case "BTTS_N":
        return home === 0 || away === 0;
    }
    if (key.startsWith("OU")) return key.endsWith("_O") ? total > ouLine(key) : total < ouLine(key);
    throw new Error(`Unknown market ${key}`);
  })();
  return won ? "WON" : "LOST";
}
