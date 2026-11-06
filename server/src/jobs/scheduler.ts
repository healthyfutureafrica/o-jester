import cron from "node-cron";
import { env } from "../config/env.js";
import { appToday } from "../lib/clock.js";
import { createLogger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { runFullRefresh, runScoresRefresh } from "./pipeline.js";

const log = createLogger("scheduler");

export async function startScheduler() {
  cron.schedule(env.FULL_REFRESH_CRON, () => void runFullRefresh(), { timezone: env.APP_TIMEZONE, name: "full-refresh" });
  cron.schedule(env.SCORES_CRON, () => void runScoresRefresh(), { timezone: env.APP_TIMEZONE, name: "scores-refresh" });
  log.info(`scheduled full refresh "${env.FULL_REFRESH_CRON}" and score updates "${env.SCORES_CRON}" (${env.APP_TIMEZONE})`);

  // Warm start: make sure today has data after a deploy or first boot.
  const today = appToday();
  const hasToday = await prisma.match.count({ where: { matchDate: today } });
  if (!hasToday) void runFullRefresh();
}
