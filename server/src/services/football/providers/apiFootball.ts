import { leagueByApiFootballId, leagueByKey } from "../../../config/leagues.js";
import { createLogger } from "../../../lib/logger.js";
import type { BookOdds, FootballProvider, LeagueTable, MatchStatus, ProviderFixture, TeamForm } from "../types.js";
import { TtlCache, tableFromRows } from "./shared.js";

/**
 * API-Football v3 (api-sports.io). Docs: https://www.api-football.com/documentation-v3
 * Quota-aware: fixtures = 1 call/date, standings cached 12h per league, odds paginated per date.
 */

const BASE_URL = "https://v3.football.api-sports.io";
const log = createLogger("api-football");

interface ApiResponse<T> {
  errors: unknown;
  results: number;
  paging?: { current: number; total: number };
  response: T;
}

interface ApiFixture {
  fixture: { id: number; date: string; status: { short: string } };
  league: { id: number; season: number };
  teams: { home: { id: number; name: string; logo: string }; away: { id: number; name: string; logo: string } };
  goals: { home: number | null; away: number | null };
  score: { fulltime: { home: number | null; away: number | null } };
}

interface ApiStandingRow {
  rank: number;
  points: number;
  form: string | null;
  team: { id: number; name: string };
  all: { played: number; goals: { for: number; against: number } };
  home: { played: number; goals: { for: number; against: number } };
  away: { played: number; goals: { for: number; against: number } };
}

interface ApiOdds {
  fixture: { id: number };
  bookmakers: { id: number; bets: { id: number; name: string; values: { value: string; odd: string }[] }[] }[];
}

const STATUS: Record<string, MatchStatus> = {
  TBD: "SCHEDULED",
  NS: "SCHEDULED",
  FT: "FINISHED",
  AET: "FINISHED",
  PEN: "FINISHED",
  PST: "POSTPONED",
  CANC: "CANCELLED",
  ABD: "CANCELLED",
  AWD: "CANCELLED",
  WO: "CANCELLED",
};

export class ApiFootballProvider implements FootballProvider {
  readonly name = "api-football";
  private tables = new TtlCache<LeagueTable | null>(12 * 60 * 60 * 1000);

  constructor(
    private apiKey: string,
    private tz: string,
    private bookmaker: number,
  ) {}

  private async get<T>(path: string, params: Record<string, string | number>): Promise<ApiResponse<T>> {
    const url = new URL(BASE_URL + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await fetch(url, { headers: { "x-apisports-key": this.apiKey } });
    if (!res.ok) throw new Error(`API-Football ${path} HTTP ${res.status}`);
    const body = (await res.json()) as ApiResponse<T>;
    const errors = body.errors;
    const hasErrors = Array.isArray(errors) ? errors.length > 0 : errors && Object.keys(errors as object).length > 0;
    if (hasErrors) throw new Error(`API-Football ${path}: ${JSON.stringify(errors)}`);
    return body;
  }

  async fixturesForDate(date: string): Promise<ProviderFixture[]> {
    const { response } = await this.get<ApiFixture[]>("/fixtures", { date, timezone: this.tz });
    const out: ProviderFixture[] = [];
    for (const f of response) {
      const league = leagueByApiFootballId(f.league.id);
      if (!league) continue;
      const status = STATUS[f.fixture.status.short] ?? "LIVE";
      // Settle on the 90-minute score; fall back to final goals if fulltime isn't populated.
      const ft = f.score?.fulltime;
      const finished = status === "FINISHED";
      out.push({
        externalId: `apif:${f.fixture.id}`,
        leagueKey: league.key,
        kickoff: new Date(f.fixture.date),
        status,
        homeTeam: f.teams.home.name,
        awayTeam: f.teams.away.name,
        homeTeamId: String(f.teams.home.id),
        awayTeamId: String(f.teams.away.id),
        homeLogo: f.teams.home.logo,
        awayLogo: f.teams.away.logo,
        homeGoals: finished ? (ft?.home ?? f.goals.home) : f.goals.home,
        awayGoals: finished ? (ft?.away ?? f.goals.away) : f.goals.away,
        season: f.league.season,
      });
    }
    return out;
  }

  async leagueTable(leagueKey: string, fixture: ProviderFixture): Promise<LeagueTable | null> {
    const league = leagueByKey(leagueKey);
    if (!league?.apiFootballId || !fixture.season) return null;
    const cacheKey = `${league.apiFootballId}:${fixture.season}`;
    return this.tables.getOrLoad(cacheKey, async () => {
      try {
        const { response } = await this.get<{ league: { standings: ApiStandingRow[][] } }[]>("/standings", {
          league: league.apiFootballId!,
          season: fixture.season!,
        });
        const rows = (response[0]?.league.standings ?? []).flat();
        if (!rows.length) return null;
        return tableFromRows(
          rows.map((r) => ({
            teamId: String(r.team.id),
            form: {
              played: r.all.played,
              gf: r.all.goals.for,
              ga: r.all.goals.against,
              homePlayed: r.home.played,
              homeGf: r.home.goals.for,
              homeGa: r.home.goals.against,
              awayPlayed: r.away.played,
              awayGf: r.away.goals.for,
              awayGa: r.away.goals.against,
              // API-Football lists form newest-first; normalise to oldest-first.
              form: r.form ? [...r.form].reverse().join("") : undefined,
              position: r.rank,
              points: r.points,
            } satisfies TeamForm,
          })),
        );
      } catch (err) {
        log.warn(`standings unavailable for ${leagueKey}`, err);
        return null;
      }
    });
  }

  async oddsForDate(date: string, fixtures: ProviderFixture[]): Promise<Map<string, BookOdds>> {
    const wanted = new Set(fixtures.map((f) => f.externalId));
    const out = new Map<string, BookOdds>();
    if (!wanted.size) return out;
    let page = 1;
    let total = 1;
    do {
      const body = await this.get<ApiOdds[]>("/odds", { date, bookmaker: this.bookmaker, timezone: this.tz, page });
      total = Math.min(body.paging?.total ?? 1, 15);
      for (const item of body.response) {
        const id = `apif:${item.fixture.id}`;
        if (!wanted.has(id)) continue;
        const bets = item.bookmakers[0]?.bets ?? [];
        const odds = parseBets(bets);
        if (Object.keys(odds).length) out.set(id, odds);
      }
      page++;
    } while (page <= total);
    return out;
  }
}

function parseBets(bets: ApiOdds["bookmakers"][number]["bets"]): BookOdds {
  const odds: BookOdds = {};
  const set = (key: string, raw: string) => {
    const v = Number(raw);
    if (v > 1) odds[key] = v;
  };
  for (const bet of bets) {
    const name = bet.name.toLowerCase();
    for (const { value, odd } of bet.values) {
      const v = String(value);
      if (bet.id === 1 || name === "match winner") {
        if (v === "Home") set("1X2_H", odd);
        else if (v === "Draw") set("1X2_D", odd);
        else if (v === "Away") set("1X2_A", odd);
      } else if (bet.id === 12 || name === "double chance") {
        if (v === "Home/Draw") set("DC_1X", odd);
        else if (v === "Home/Away") set("DC_12", odd);
        else if (v === "Draw/Away") set("DC_X2", odd);
      } else if (bet.id === 5 || name === "goals over/under") {
        const m = /^(Over|Under) (1\.5|2\.5|3\.5)$/.exec(v);
        if (m) set(`OU${m[2].replace(".", "")}_${m[1] === "Over" ? "O" : "U"}`, odd);
      } else if (bet.id === 8 || name === "both teams score") {
        if (v === "Yes") set("BTTS_Y", odd);
        else if (v === "No") set("BTTS_N", odd);
      } else if (bet.id === 10 || name === "exact score") {
        const m = /^(\d+):(\d+)$/.exec(v);
        if (m) set(`CS_${m[1]}-${m[2]}`, odd);
      }
    }
  }
  return odds;
}
