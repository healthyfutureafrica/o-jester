import { appToday } from "../lib/clock.js";
import { addDays } from "../lib/dates.js";
import { createLogger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { analyzeUpcoming } from "../services/ai/service.js";
import { generateCombos } from "../services/combos/service.js";
import { ingestDate } from "../services/football/ingest.js";
import { predictDate, settleResults } from "../services/predictions/service.js";

const log = createLogger("pipeline");
let running = false;

async function tracked<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  if (running) {
    log.warn(`${name} skipped — another job is running`);
    return null;
  }
  running = true;
  const run = await prisma.jobRun.create({ data: { name } });
  const started = Date.now();
  try {
    const result = await fn();
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: true, detail: JSON.stringify(result) },
    });
    log.info(`${name} finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return result;
  } catch (err) {
    log.error(`${name} failed`, err);
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), ok: false, detail: err instanceof Error ? err.message : String(err) },
    });
    return null;
  } finally {
    running = false;
  }
}

/**
 * Full refresh: fixtures, odds & tables → predictions → AI analysis → combos → settlement.
 * Covers yesterday (late results), today and tomorrow.
 */
export function runFullRefresh({ force = false }: { force?: boolean } = {}) {
  return tracked("full-refresh", async () => {
    const today = appToday();
    const yesterday = addDays(today, -1);
    const tomorrow = addDays(today, 1);
    const ingest = [
      await ingestDate(yesterday, { odds: false, tables: false }),
      await ingestDate(today),
      await ingestDate(tomorrow),
    ];
    const predicted = (await predictDate(today)) + (await predictDate(tomorrow));
    const analysed = await analyzeUpcoming([today, tomorrow]);
    const combos = { today: await generateCombos(today, { force }), tomorrow: await generateCombos(tomorrow, { force }) };
    const settled = await settleResults();
    return { ingest, predicted, analysed, combos, settled };
  });
}

/** Lightweight score update — only calls the provider when matches are in play. */
export function runScoresRefresh() {
  return tracked("scores-refresh", async () => {
    const now = Date.now();
    const inPlay = await prisma.match.findMany({
      where: {
        status: { in: ["SCHEDULED", "LIVE"] },
        kickoff: { lt: new Date(now), gt: new Date(now - 4 * 3600 * 1000) },
      },
      select: { matchDate: true },
      distinct: ["matchDate"],
    });
    for (const { matchDate } of inPlay) await ingestDate(matchDate, { odds: false, tables: false });
    const settled = await settleResults();
    return { dates: inPlay.map((m) => m.matchDate), settled };
  });
}

