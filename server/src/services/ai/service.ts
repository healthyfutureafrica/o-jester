import { env } from "../../config/env.js";
import { createLogger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { parseJson } from "../../lib/util.js";
import { confidenceFor, type DataQuality, type PredictionMeta } from "../predictions/engine.js";
import type { MarketProb } from "../predictions/markets.js";
import { aiEnabled, analyzeMatch } from "./analyst.js";

const log = createLogger("ai-service");
const CONCURRENCY = 3;

/**
 * Run Claude analysis on the most relevant upcoming fixtures. Each fixture is
 * analysed once, then refreshed close to kick-off (when line-up news lands).
 * Bounded by AI_MAX_MATCH_ANALYSES_PER_RUN to keep API spend predictable.
 */
export async function analyzeUpcoming(dates: string[]) {
  if (!aiEnabled || env.AI_MAX_MATCH_ANALYSES_PER_RUN === 0) return 0;
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 18 * 3600 * 1000);
  const soon = new Date(now.getTime() + 8 * 3600 * 1000);

  const preds = await prisma.prediction.findMany({
    where: {
      match: { matchDate: { in: dates }, status: "SCHEDULED", kickoff: { gt: now } },
      OR: [{ aiAnalysis: null }, { aiAnalyzedAt: { lt: staleBefore }, match: { kickoff: { lt: soon } } }],
    },
    include: { match: true },
    orderBy: [{ confidence: "desc" }],
    take: env.AI_MAX_MATCH_ANALYSES_PER_RUN,
  });
  if (!preds.length) return 0;

  let done = 0;
  const queue = [...preds];
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const markets = parseJson<MarketProb[]>(p.markets, []);
      const analysis = await analyzeMatch({
        leagueName: p.match.leagueName,
        country: p.match.country,
        kickoff: p.match.kickoff,
        homeTeam: p.match.homeTeam,
        awayTeam: p.match.awayTeam,
        lambdaHome: p.lambdaHome,
        lambdaAway: p.lambdaAway,
        markets,
        stats: parseJson(p.match.teamStats, null),
        dataQuality: p.dataQuality,
      });
      if (!analysis) continue;
      const best = markets.find((m) => m.key === p.bestMarket);
      const meta = parseJson<PredictionMeta>(p.meta, { statsLambdas: null, marketLambdas: null, disagreement: 0 });
      await prisma.prediction.update({
        where: { id: p.id },
        data: {
          aiAnalysis: JSON.stringify(analysis),
          aiModel: analysis.model,
          aiAnalyzedAt: new Date(),
          ...(best
            ? { confidence: confidenceFor(best, p.dataQuality as DataQuality, meta.disagreement, analysis.confidenceDelta) }
            : {}),
        },
      });
      done++;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log.info(`analysed ${done}/${preds.length} fixtures with ${env.AI_MODEL}`);
  return done;
}
