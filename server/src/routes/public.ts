import { Router } from "express";
import { env, paymentConfig } from "../config/env.js";
import { LEAGUES } from "../config/leagues.js";
import { PLAN_IDS, planView, SUBSCRIPTION_DAYS } from "../config/plans.js";
import { appToday } from "../lib/clock.js";
import { addDays } from "../lib/dates.js";
import { prisma } from "../lib/prisma.js";
import { parseJson } from "../lib/util.js";
import { aiEnabled } from "../services/ai/analyst.js";
import { COMBO_LOCK_HOUR } from "../services/combos/service.js";
import { footballProvider } from "../services/football/index.js";
import { confidenceFor, type DataQuality, pickBest, type PredictionMeta } from "../services/predictions/engine.js";
import { type MarketProb, marketLabel, marketShort } from "../services/predictions/markets.js";
import { paymentMethods } from "../services/payments/service.js";

export const publicRouter = Router();

publicRouter.get("/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

publicRouter.get("/meta", (_req, res) => {
  const today = appToday();
  res.json({
    today,
    tomorrow: addDays(today, 1),
    timezone: env.APP_TIMEZONE,
    provider: footballProvider.name,
    aiEnabled,
    sandboxPayments: paymentConfig.sandbox,
    paymentMethods: paymentMethods(),
    comboLockHour: COMBO_LOCK_HOUR,
  });
});

publicRouter.get("/plans", (req, res) => {
  res.json({ currency: "XAF", subscriptionDays: SUBSCRIPTION_DAYS, plans: PLAN_IDS.map((id) => planView(id, req.lang)) });
});

publicRouter.get("/leagues", (_req, res) => {
  res.json({ leagues: LEAGUES.map(({ key, name, country, tier }) => ({ key, name, country, tier })) });
});

/** A free daily sample pick for the landing page: the strongest Top-5 result tip of the day. */
publicRouter.get("/teaser", async (req, res) => {
  const today = appToday();
  const [matches, total] = await Promise.all([
    prisma.match.findMany({
      where: { matchDate: today, status: "SCHEDULED", kickoff: { gt: new Date() }, prediction: { isNot: null } },
      include: { prediction: true },
    }),
    prisma.match.count({ where: { matchDate: today } }),
  ]);
  const tier1 = new Set(LEAGUES.filter((l) => l.tier === 1).map((l) => l.key));
  let best: { match: (typeof matches)[number]; pick: MarketProb } | null = null;
  for (const m of matches) {
    if (!tier1.has(m.leagueKey)) continue;
    const pick = pickBest(parseJson<MarketProb[]>(m.prediction!.markets, []), ["RESULT"], 1.3);
    if (pick && (!best || pick.probability > best.pick.probability)) best = { match: m, pick };
  }
  res.json({
    date: today,
    fixturesToday: total,
    pick: best && {
      matchId: best.match.id,
      leagueName: best.match.leagueName,
      kickoff: best.match.kickoff.toISOString(),
      homeTeam: best.match.homeTeam,
      awayTeam: best.match.awayTeam,
      short: marketShort(best.pick.key, req.lang),
      label: marketLabel(best.pick.key, best.match.homeTeam, best.match.awayTeam, req.lang),
      probability: best.pick.probability,
      odds: best.pick.bookOdds ?? null,
      confidence: confidenceFor(
        best.pick,
        best.match.prediction!.dataQuality as DataQuality,
        parseJson<PredictionMeta>(best.match.prediction!.meta, { statsLambdas: null, marketLambdas: null, disagreement: 0 }).disagreement,
      ),
    },
  });
});
