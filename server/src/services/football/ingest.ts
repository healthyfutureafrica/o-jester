import { leagueByKey } from "../../config/leagues.js";
import { createLogger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { footballProvider } from "./index.js";
import type { BookOdds, LeagueTable, MatchStatsInput } from "./types.js";

const log = createLogger("ingest");

export interface IngestOptions {
  odds?: boolean;
  tables?: boolean;
}

/** Pull fixtures (and optionally odds + league tables) for a date and upsert them. */
export async function ingestDate(date: string, opts: IngestOptions = {}) {
  const provider = footballProvider;
  const fixtures = await provider.fixturesForDate(date);
  const scheduled = fixtures.filter((f) => f.status === "SCHEDULED");

  let odds = new Map<string, BookOdds>();
  if (opts.odds !== false && scheduled.length) {
    try {
      odds = await provider.oddsForDate(date, scheduled);
    } catch (err) {
      log.warn(`odds fetch failed for ${date}`, err);
    }
  }

  let withStats = 0;
  for (const f of fixtures) {
    const league = leagueByKey(f.leagueKey);
    if (!league) continue;

    let table: LeagueTable | null = null;
    if (opts.tables !== false && f.status === "SCHEDULED") {
      try {
        table = await provider.leagueTable(f.leagueKey, f);
      } catch (err) {
        log.warn(`league table failed for ${f.leagueKey}`, err);
      }
    }

    const data = {
      leagueKey: league.key,
      leagueName: league.name,
      country: league.country,
      kickoff: f.kickoff,
      matchDate: date,
      status: f.status,
      homeTeam: f.homeTeam,
      awayTeam: f.awayTeam,
      homeLogo: f.homeLogo ?? null,
      awayLogo: f.awayLogo ?? null,
      homeGoals: f.homeGoals ?? null,
      awayGoals: f.awayGoals ?? null,
      // Only overwrite odds/stats when fresh values were fetched.
      ...(odds.has(f.externalId) ? { odds: JSON.stringify(odds.get(f.externalId)) } : {}),
      ...(table
        ? {
            teamStats: JSON.stringify({
              home: table.teams.get(f.homeTeamId) ?? null,
              away: table.teams.get(f.awayTeamId) ?? null,
              league: table.league,
            } satisfies MatchStatsInput),
          }
        : {}),
    };
    if (table) withStats++;
    await prisma.match.upsert({ where: { externalId: f.externalId }, create: { externalId: f.externalId, ...data }, update: data });
  }

  log.info(`${date}: ${fixtures.length} fixtures (${odds.size} with odds, ${withStats} with tables) via ${provider.name}`);
  return { date, fixtures: fixtures.length, withOdds: odds.size, withStats };
}
