import { leagueByFootballDataCode, leagueByKey, LEAGUES } from "../../../config/leagues.js";
import { addDays, localDate } from "../../../lib/dates.js";
import { createLogger } from "../../../lib/logger.js";
import type { BookOdds, FootballProvider, LeagueTable, MatchStatus, ProviderFixture, TeamForm } from "../types.js";
import { Throttle, TtlCache, tableFromRows } from "./shared.js";

/**
 * football-data.org v4. Docs: https://docs.football-data.org/general/v4/index.html
 * The free tier covers 12 competitions, 10 requests/minute and no odds — predictions
 * then rely on the statistical model only (data quality MEDIUM).
 */

const BASE_URL = "https://api.football-data.org/v4";
const log = createLogger("football-data");

interface FdTeam {
  id: number;
  name: string;
  shortName?: string;
  crest?: string;
}

interface FdMatch {
  id: number;
  utcDate: string;
  status: string;
  competition: { code: string };
  season?: { startDate: string };
  homeTeam: FdTeam;
  awayTeam: FdTeam;
  score: {
    duration?: string;
    fullTime: { home: number | null; away: number | null };
    regularTime?: { home: number | null; away: number | null };
  };
}

interface FdTableRow {
  position: number;
  team: FdTeam;
  playedGames: number;
  form: string | null;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
}

const STATUS: Record<string, MatchStatus> = {
  SCHEDULED: "SCHEDULED",
  TIMED: "SCHEDULED",
  FINISHED: "FINISHED",
  AWARDED: "FINISHED",
  POSTPONED: "POSTPONED",
  SUSPENDED: "POSTPONED",
  CANCELLED: "CANCELLED",
};

export class FootballDataProvider implements FootballProvider {
  readonly name = "football-data";
  private throttle = new Throttle(6500);
  private tables = new TtlCache<LeagueTable | null>(12 * 60 * 60 * 1000);

  constructor(
    private apiKey: string,
    private tz: string,
  ) {}

  private get<T>(path: string): Promise<T> {
    return this.throttle.run(async () => {
      const res = await fetch(BASE_URL + path, { headers: { "X-Auth-Token": this.apiKey } });
      if (!res.ok) throw new Error(`football-data ${path} HTTP ${res.status}: ${await res.text()}`);
      return (await res.json()) as T;
    });
  }

  async fixturesForDate(date: string): Promise<ProviderFixture[]> {
    const codes = LEAGUES.filter((l) => l.footballDataCode).map((l) => l.footballDataCode).join(",");
    // The API filters on UTC dates; widen the window and filter by local date.
    const { matches } = await this.get<{ matches: FdMatch[] }>(
      `/matches?competitions=${codes}&dateFrom=${addDays(date, -1)}&dateTo=${addDays(date, 1)}`,
    );
    const out: ProviderFixture[] = [];
    for (const m of matches) {
      const league = leagueByFootballDataCode(m.competition.code);
      const kickoff = new Date(m.utcDate);
      if (!league || localDate(kickoff, this.tz) !== date) continue;
      const score = m.score.regularTime ?? m.score.fullTime;
      out.push({
        externalId: `fd:${m.id}`,
        leagueKey: league.key,
        kickoff,
        status: STATUS[m.status] ?? "LIVE",
        homeTeam: m.homeTeam.shortName || m.homeTeam.name,
        awayTeam: m.awayTeam.shortName || m.awayTeam.name,
        homeTeamId: String(m.homeTeam.id),
        awayTeamId: String(m.awayTeam.id),
        homeLogo: m.homeTeam.crest,
        awayLogo: m.awayTeam.crest,
        homeGoals: score.home,
        awayGoals: score.away,
        season: m.season ? Number(m.season.startDate.slice(0, 4)) : undefined,
      });
    }
    return out;
  }

  async leagueTable(leagueKey: string): Promise<LeagueTable | null> {
    const code = leagueByKey(leagueKey)?.footballDataCode;
    if (!code) return null;
    return this.tables.getOrLoad(code, async () => {
      try {
        const { standings } = await this.get<{ standings: { type: string; table: FdTableRow[] }[] }>(
          `/competitions/${code}/standings`,
        );
        const pick = (type: string) => standings.filter((s) => s.type === type).flatMap((s) => s.table);
        const total = pick("TOTAL");
        if (!total.length) return null;
        const home = new Map(pick("HOME").map((r) => [r.team.id, r]));
        const away = new Map(pick("AWAY").map((r) => [r.team.id, r]));
        return tableFromRows(
          total.map((r) => {
            const h = home.get(r.team.id);
            const a = away.get(r.team.id);
            return {
              teamId: String(r.team.id),
              form: {
                played: r.playedGames,
                gf: r.goalsFor,
                ga: r.goalsAgainst,
                homePlayed: h?.playedGames ?? 0,
                homeGf: h?.goalsFor ?? 0,
                homeGa: h?.goalsAgainst ?? 0,
                awayPlayed: a?.playedGames ?? 0,
                awayGf: a?.goalsFor ?? 0,
                awayGa: a?.goalsAgainst ?? 0,
                form: r.form ? r.form.split(",").join("") : undefined,
                position: r.position,
                points: r.points,
              } satisfies TeamForm,
            };
          }),
        );
      } catch (err) {
        log.warn(`standings unavailable for ${leagueKey}`, err);
        return null;
      }
    });
  }

  async oddsForDate(): Promise<Map<string, BookOdds>> {
    return new Map(); // not offered on football-data.org
  }
}
