import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "../../config/env.js";
import type { Lang } from "../../i18n/index.js";
import { createLogger } from "../../lib/logger.js";
import type { MarketProb } from "../predictions/markets.js";
import { marketLabel } from "../predictions/markets.js";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

const log = createLogger("ai");

const client = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
export const aiEnabled = client !== null;

/**
 * Server-side refusal fallback: if the primary model declines, the API re-runs
 * the request on an appropriate fallback model within the same call.
 */
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } satisfies Partial<CreateParams>;

// ---------------------------------------------------------------------------
// Match analysis
// ---------------------------------------------------------------------------

/** Text written by the analyst, produced once per supported language. */
const AnalysisTextSchema = z.object({
  headline: z.string().min(1).max(200),
  summary: z.string().min(1).max(1500),
  keyFactors: z.array(z.string()).max(6),
  teamNews: z.array(z.string()).max(6),
  risks: z.array(z.string()).max(5),
  reasoning: z.string().max(800),
});
export type AnalysisText = z.infer<typeof AnalysisTextSchema>;

const AnalysisSchema = z.object({
  stance: z.enum(["BACK", "LEAN", "AVOID"]),
  market: z.string(),
  confidenceDelta: z.number().int().min(-15).max(10),
  en: AnalysisTextSchema,
  fr: AnalysisTextSchema,
});

export type MatchAnalysis = z.infer<typeof AnalysisSchema> & {
  sources: { title: string; url: string }[];
  model: string;
  generatedAt: string;
};

export interface AnalysisInput {
  leagueName: string;
  country: string;
  kickoff: Date;
  homeTeam: string;
  awayTeam: string;
  lambdaHome: number;
  lambdaAway: number;
  markets: MarketProb[];
  stats: unknown;
  dataQuality: string;
}

const ANALYST_SYSTEM = `You are the senior football analyst for O-Jester, a bilingual (English/French) soccer prediction-tips service. O-Jester is not a betting operator: subscribers read our tips and decide for themselves.

For each fixture you receive the output of our statistical model (Dixon–Coles Poisson, blended with bookmaker prices) and season statistics. Your job:
1. Use web search to check the latest team news for this fixture: injuries, suspensions, expected line-ups, rotation risk (e.g. a cup game in the next few days), managerial changes, motivation. Prefer reports from the last 7 days and reputable outlets.
2. Weigh that news against the model. The model cannot see team news, so your value is in spotting what it misses.
3. Give a verdict on ONE market key from the list provided: BACK (strong, supported by news), LEAN (reasonable but with caveats), or AVOID (the match is too uncertain to include in accumulators — e.g. key absences, dead rubber, heavy rotation).
4. confidenceDelta adjusts our confidence score: positive if news strengthens the pick, negative if it weakens it. Use 0 when you found nothing material.

Be calibrated and honest: never promise a win, never invent injuries or statistics. If search finds nothing useful, say so in teamNews and rely on the model. Never encourage betting or urge readers to stake money.

Write every text field twice: once in clear, plain English ("en") and once in natural, idiomatic French as used in Cameroon and francophone Africa ("fr"). The two versions must say the same thing; do not translate team or competition names.

Your final message must be a single JSON object (no surrounding prose) with exactly these fields:
{"stance": "BACK"|"LEAN"|"AVOID", "market": <one of the provided market keys>, "confidenceDelta": integer between -15 and 10,
 "en": {"headline": string, "summary": string (2-4 sentences), "keyFactors": string[] (max 6), "teamNews": string[] (max 6), "risks": string[] (max 5), "reasoning": string (why this stance on this market)},
 "fr": {same fields as "en", written in French}}`;

function describeMarkets(markets: MarketProb[], home: string, away: string) {
  return markets
    .filter((m) => m.group !== "SCORE")
    .map((m) => ({
      key: m.key,
      selection: marketLabel(m.key, home, away),
      modelProbability: Math.round(m.probability * 1000) / 10,
      bookmakerOdds: m.bookOdds ?? null,
      edge: m.edge ?? null,
    }));
}

/** Runs a request that may use server tools, resuming if the server pauses a long turn. */
async function createWithServerTools(params: Omit<CreateParams, "messages">, messages: BetaMessageParam[]): Promise<BetaMessage> {
  let convo = messages;
  for (let i = 0; i < 4; i++) {
    const res = await client!.beta.messages.create({ ...params, messages: convo });
    if (res.stop_reason !== "pause_turn") return res;
    convo = [...convo, { role: "assistant", content: res.content }];
  }
  throw new Error("analysis did not complete after resuming");
}

function textOf(res: BetaMessage): string {
  return res.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/g;
  let lastFence: string | null = null;
  for (const m of text.matchAll(fenced)) lastFence = m[1];
  const candidate = lastFence ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate);
}

function sourcesOf(res: BetaMessage): { title: string; url: string }[] {
  const out: { title: string; url: string }[] = [];
  for (const block of res.content) {
    if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue;
    for (const r of block.content) {
      if (r.type === "web_search_result" && !out.some((s) => s.url === r.url)) out.push({ title: r.title, url: r.url });
    }
  }
  return out.slice(0, 6);
}

export async function analyzeMatch(input: AnalysisInput): Promise<MatchAnalysis | null> {
  if (!client) return null;
  const allowedKeys = input.markets.filter((m) => m.group !== "SCORE").map((m) => m.key);
  const fixture = {
    competition: `${input.leagueName} (${input.country})`,
    kickoffUtc: input.kickoff.toISOString(),
    home: input.homeTeam,
    away: input.awayTeam,
    modelExpectedGoals: { home: input.lambdaHome, away: input.lambdaAway },
    dataQuality: input.dataQuality,
    seasonStats: input.stats,
    markets: describeMarkets(input.markets, input.homeTeam, input.awayTeam),
  };

  try {
    const res = await createWithServerTools(
      {
        model: env.AI_MODEL,
        max_tokens: 16000,
        ...FALLBACK,
        output_config: { effort: "medium" },
        system: ANALYST_SYSTEM,
        tools: env.AI_WEB_SEARCH ? [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }] : undefined,
      },
      [{ role: "user", content: `Analyse this fixture. Today is ${new Date().toISOString().slice(0, 10)}.\n\n${JSON.stringify(fixture, null, 2)}` }],
    );

    if (res.stop_reason === "refusal") {
      log.warn(`analysis declined for ${input.homeTeam} v ${input.awayTeam}`, res.stop_details?.category);
      return null;
    }
    const parsed = AnalysisSchema.safeParse(extractJsonObject(textOf(res)));
    if (!parsed.success) {
      log.warn(`analysis output invalid for ${input.homeTeam} v ${input.awayTeam}`, parsed.error.issues[0]?.message);
      return null;
    }
    const analysis = parsed.data;
    if (!allowedKeys.includes(analysis.market)) analysis.market = allowedKeys[0];
    return { ...analysis, sources: sourcesOf(res), model: res.model, generatedAt: new Date().toISOString() };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) log.warn("rate limited while analysing; will retry next run");
    else if (err instanceof Anthropic.APIError) log.error(`Claude API error ${err.status}`, err.message);
    else log.error("analysis failed", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Slip risk review (Elite)
// ---------------------------------------------------------------------------

export interface SlipReviewSelection {
  matchId: string;
  fixture: string;
  competition: string;
  kickoff: string;
  market: string;
  selection: string;
  modelProbability: number;
  odds: number;
  aiStance?: string;
  teamNews?: string[];
  risks?: string[];
}

const SlipReviewSchema = z.object({
  overallRisk: z.enum(["LOW", "MEDIUM", "HIGH", "VERY_HIGH"]),
  verdict: z.string(),
  weakLinks: z.array(z.object({ matchId: z.string(), reason: z.string() })),
  suggestions: z.array(z.string()),
});
export type SlipReview = z.infer<typeof SlipReviewSchema> & { model: string };

const SLIP_REVIEW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overallRisk", "verdict", "weakLinks", "suggestions"],
  properties: {
    overallRisk: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"] },
    verdict: { type: "string", description: "2-3 sentence plain-English assessment of the slip." },
    weakLinks: {
      type: "array",
      description: "Selections most likely to break the slip, weakest first.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["matchId", "reason"],
        properties: { matchId: { type: "string" }, reason: { type: "string" } },
      },
    },
    suggestions: { type: "array", items: { type: "string" }, description: "Concrete, actionable improvements (max 4)." },
  },
} as const;

const REVIEW_SYSTEM = `You review custom tip combinations for O-Jester subscribers (O-Jester is a prediction-tips service, not a betting operator). You receive each selection with our model's probability, the odds, and any team news our analysts found. Assess the combined risk honestly — accumulators compound risk, and the combined probability is shown. Identify the weakest links using the data given (low probability, negative news, AVOID stances, short odds that add risk without much return) and suggest concrete improvements such as removing a leg or switching to a safer market on the same match. Never guarantee outcomes and never encourage anyone to bet. Keep it concise.`;

export async function reviewSlip(
  selections: SlipReviewSelection[],
  combined: { odds: number; probability: number },
  lang: Lang,
): Promise<SlipReview | null> {
  if (!client) return null;
  try {
    const res = await client.beta.messages.create({
      model: env.AI_MODEL,
      max_tokens: 16000,
      ...FALLBACK,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SLIP_REVIEW_JSON_SCHEMA } },
      system: `${REVIEW_SYSTEM}

Write all text fields in ${lang === "fr" ? "French (natural, as used in Cameroon and francophone Africa)" : "English"}.`,
      messages: [
        {
          role: "user",
          content: JSON.stringify(
            {
              combinedOdds: combined.odds,
              combinedModelProbabilityPercent: Math.round(combined.probability * 1000) / 10,
              selections,
            },
            null,
            2,
          ),
        },
      ],
    });
    if (res.stop_reason === "refusal") return null;
    const parsed = SlipReviewSchema.safeParse(JSON.parse(textOf(res)));
    return parsed.success ? { ...parsed.data, model: res.model } : null;
  } catch (err) {
    if (err instanceof Anthropic.APIError) log.error(`slip review API error ${err.status}`, err.message);
    else log.error("slip review failed", err);
    return null;
  }
}
