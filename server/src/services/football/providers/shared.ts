import type { LeagueTable, TeamForm } from "../types.js";

/** Tiny in-memory TTL cache that also de-duplicates concurrent loads. */
export class TtlCache<T> {
  private store = new Map<string, { value: Promise<T>; expires: number }>();
  constructor(private ttlMs: number) {}

  getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = load().catch((err) => {
      this.store.delete(key);
      throw err;
    });
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
    return value;
  }
}

/** Build a LeagueTable (team records + league scoring averages) from standings rows. */
export function tableFromRows(rows: { teamId: string; form: TeamForm }[]): LeagueTable {
  const teams = new Map<string, TeamForm>();
  let homeGoals = 0;
  let homeGames = 0;
  let awayGoals = 0;
  let awayGames = 0;
  let allGoals = 0;
  let allGames = 0;
  for (const { teamId, form } of rows) {
    teams.set(teamId, form);
    homeGoals += form.homeGf;
    homeGames += form.homePlayed;
    awayGoals += form.awayGf;
    awayGames += form.awayPlayed;
    allGoals += form.gf;
    allGames += form.played;
  }
  const perTeamGame = allGames ? allGoals / allGames : 1.35;
  return {
    teams,
    league: {
      avgHomeGoals: homeGames >= 10 ? homeGoals / homeGames : perTeamGame * 1.1,
      avgAwayGoals: awayGames >= 10 ? awayGoals / awayGames : perTeamGame * 0.9,
    },
  };
}

/** Serialises calls so that consecutive requests are at least `intervalMs` apart. */
export class Throttle {
  private last = 0;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private intervalMs: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      const wait = this.last + this.intervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      return fn();
    });
    this.chain = next.catch(() => undefined);
    return next;
  }
}
