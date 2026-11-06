/**
 * League catalogue. Each league maps to its id at the supported data providers.
 * `tier` controls which subscription plan can see it (see plans.ts).
 * API-Football ids can be checked at https://dashboard.api-football.com (Leagues & Cups).
 */
export interface LeagueDef {
  key: string;
  name: string;
  country: string;
  tier: 1 | 2 | 3;
  apiFootballId?: number;
  footballDataCode?: string;
}

export const LEAGUES: LeagueDef[] = [
  // Tier 1 — Starter and above
  { key: "eng-pl", name: "Premier League", country: "England", tier: 1, apiFootballId: 39, footballDataCode: "PL" },
  { key: "esp-laliga", name: "La Liga", country: "Spain", tier: 1, apiFootballId: 140, footballDataCode: "PD" },
  { key: "ita-seriea", name: "Serie A", country: "Italy", tier: 1, apiFootballId: 135, footballDataCode: "SA" },
  { key: "ger-bundesliga", name: "Bundesliga", country: "Germany", tier: 1, apiFootballId: 78, footballDataCode: "BL1" },
  { key: "fra-ligue1", name: "Ligue 1", country: "France", tier: 1, apiFootballId: 61, footballDataCode: "FL1" },
  { key: "uefa-ucl", name: "UEFA Champions League", country: "Europe", tier: 1, apiFootballId: 2, footballDataCode: "CL" },

  // Tier 2 — Pro and above
  { key: "uefa-uel", name: "UEFA Europa League", country: "Europe", tier: 2, apiFootballId: 3 },
  { key: "uefa-uecl", name: "UEFA Conference League", country: "Europe", tier: 2, apiFootballId: 848 },
  { key: "ned-eredivisie", name: "Eredivisie", country: "Netherlands", tier: 2, apiFootballId: 88, footballDataCode: "DED" },
  { key: "por-primeira", name: "Primeira Liga", country: "Portugal", tier: 2, apiFootballId: 94, footballDataCode: "PPL" },
  { key: "eng-championship", name: "Championship", country: "England", tier: 2, apiFootballId: 40, footballDataCode: "ELC" },
  { key: "tur-superlig", name: "Süper Lig", country: "Turkey", tier: 2, apiFootballId: 203 },
  { key: "bel-pro", name: "Pro League", country: "Belgium", tier: 2, apiFootballId: 144 },
  { key: "sco-prem", name: "Premiership", country: "Scotland", tier: 2, apiFootballId: 179 },
  { key: "bra-seriea", name: "Brasileirão Série A", country: "Brazil", tier: 2, apiFootballId: 71, footballDataCode: "BSA" },
  { key: "arg-lpf", name: "Liga Profesional", country: "Argentina", tier: 2, apiFootballId: 128 },
  { key: "usa-mls", name: "Major League Soccer", country: "USA", tier: 2, apiFootballId: 253 },
  { key: "mex-ligamx", name: "Liga MX", country: "Mexico", tier: 2, apiFootballId: 262 },
  { key: "ksa-pro", name: "Saudi Pro League", country: "Saudi Arabia", tier: 2, apiFootballId: 307 },

  // Tier 3 — Elite only
  { key: "caf-cl", name: "CAF Champions League", country: "Africa", tier: 3, apiFootballId: 12 },
  { key: "caf-afcon", name: "Africa Cup of Nations", country: "Africa", tier: 3, apiFootballId: 6 },
  { key: "fifa-wcq-africa", name: "World Cup Qualifiers — Africa", country: "Africa", tier: 3, apiFootballId: 29 },
  { key: "egy-premier", name: "Egyptian Premier League", country: "Egypt", tier: 3, apiFootballId: 233 },
  { key: "mar-botola", name: "Botola Pro", country: "Morocco", tier: 3, apiFootballId: 200 },
  { key: "rsa-premier", name: "Premiership", country: "South Africa", tier: 3, apiFootballId: 288 },
  { key: "fifa-wc", name: "FIFA World Cup", country: "World", tier: 3, apiFootballId: 1, footballDataCode: "WC" },
  { key: "uefa-euro", name: "UEFA European Championship", country: "Europe", tier: 3, apiFootballId: 4, footballDataCode: "EC" },
  { key: "uefa-nations", name: "UEFA Nations League", country: "Europe", tier: 3, apiFootballId: 5 },
  { key: "conmebol-libertadores", name: "Copa Libertadores", country: "South America", tier: 3, apiFootballId: 13 },
  { key: "ger-bundesliga2", name: "2. Bundesliga", country: "Germany", tier: 3, apiFootballId: 79 },
  { key: "ita-serieb", name: "Serie B", country: "Italy", tier: 3, apiFootballId: 136 },
  { key: "esp-laliga2", name: "La Liga 2", country: "Spain", tier: 3, apiFootballId: 141 },
  { key: "fra-ligue2", name: "Ligue 2", country: "France", tier: 3, apiFootballId: 62 },
  { key: "den-superliga", name: "Superliga", country: "Denmark", tier: 3, apiFootballId: 119 },
  { key: "sui-super", name: "Super League", country: "Switzerland", tier: 3, apiFootballId: 207 },
  { key: "aut-bundesliga", name: "Bundesliga", country: "Austria", tier: 3, apiFootballId: 218 },
  { key: "gre-super", name: "Super League", country: "Greece", tier: 3, apiFootballId: 197 },
];

const byKey = new Map(LEAGUES.map((l) => [l.key, l]));
const byApiFootball = new Map(LEAGUES.filter((l) => l.apiFootballId).map((l) => [l.apiFootballId!, l]));
const byFootballData = new Map(LEAGUES.filter((l) => l.footballDataCode).map((l) => [l.footballDataCode!, l]));

export const leagueByKey = (key: string) => byKey.get(key);
export const leagueByApiFootballId = (id: number) => byApiFootball.get(id);
export const leagueByFootballDataCode = (code: string) => byFootballData.get(code);
export const leagueTier = (key: string): number => byKey.get(key)?.tier ?? 3;
