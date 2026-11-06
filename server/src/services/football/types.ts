export type MatchStatus = "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED";

/** Season-to-date team record, as derived from a league table. */
export interface TeamForm {
  played: number;
  gf: number;
  ga: number;
  homePlayed: number;
  homeGf: number;
  homeGa: number;
  awayPlayed: number;
  awayGf: number;
  awayGa: number;
  /** Most recent results, oldest first, e.g. "WWDLW". */
  form?: string;
  position?: number;
  points?: number;
}

export interface LeagueContext {
  avgHomeGoals: number;
  avgAwayGoals: number;
}

export interface MatchStatsInput {
  home: TeamForm | null;
  away: TeamForm | null;
  league: LeagueContext | null;
}

/** Decimal bookmaker odds keyed by market key (see predictions/markets.ts). */
export type BookOdds = Record<string, number>;

export interface ProviderFixture {
  externalId: string;
  leagueKey: string;
  kickoff: Date;
  status: MatchStatus;
  homeTeam: string;
  awayTeam: string;
  homeTeamId: string;
  awayTeamId: string;
  homeLogo?: string;
  awayLogo?: string;
  homeGoals?: number | null;
  awayGoals?: number | null;
  season?: number;
}

export interface LeagueTable {
  teams: Map<string, TeamForm>;
  league: LeagueContext;
}

export interface FootballProvider {
  readonly name: string;
  /** All fixtures in catalogue leagues on a local calendar date. */
  fixturesForDate(date: string): Promise<ProviderFixture[]>;
  /** League table for a league (by catalogue key). Null when unavailable (e.g. cups). */
  leagueTable(leagueKey: string, fixture: ProviderFixture): Promise<LeagueTable | null>;
  /** Bookmaker odds for fixtures on a date, keyed by externalId. */
  oddsForDate(date: string, fixtures: ProviderFixture[]): Promise<Map<string, BookOdds>>;
}
