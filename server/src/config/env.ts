import "dotenv/config";
import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? fallback : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const isProd = process.env.NODE_ENV === "production";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    APP_URL: z.string().url().default("http://localhost:5173"),
    API_URL: z.string().url().default("http://localhost:4000"),
    DATABASE_URL: z.string().default("file:./dev.db"),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters long"),
    APP_TIMEZONE: z.string().default("Africa/Douala"),

    // Football data
    // Real-world match data is mandatory — there is no simulated mode.
    FOOTBALL_PROVIDER: z.enum(["api-football", "football-data"], {
      errorMap: () => ({ message: 'set to "api-football" or "football-data" (a real match data provider is required)' }),
    }),
    API_FOOTBALL_KEY: optionalString,
    API_FOOTBALL_BOOKMAKER: z.coerce.number().int().default(8), // 8 = Bet365
    FOOTBALL_DATA_KEY: optionalString,

    // AI (Claude)
    ANTHROPIC_API_KEY: optionalString,
    AI_MODEL: z.string().default("claude-opus-5-5"),
    AI_WEB_SEARCH: bool(true),
    AI_MAX_MATCH_ANALYSES_PER_RUN: z.coerce.number().int().min(0).default(20),

    // Payments
    PAYMENTS_SANDBOX: bool(!isProd),
    // API Manager base/context URL before /api/order; credentials remain server-side.
    ENKAP_API_BASE_URL: optionalString,
    ENKAP_TOKEN_URL: optionalString,
    ENKAP_ACCESS_TOKEN: optionalString,
    ENKAP_CONSUMER_KEY: optionalString,
    ENKAP_CONSUMER_SECRET: optionalString,
    ENKAP_API_KEY: optionalString,
    ENKAP_API_SECRET: optionalString,
    FLUTTERWAVE_SECRET_KEY: optionalString,
    FLUTTERWAVE_WEBHOOK_HASH: optionalString,
    PAYPAL_CLIENT_ID: optionalString,
    PAYPAL_CLIENT_SECRET: optionalString,
    PAYPAL_WEBHOOK_ID: optionalString,
    PAYPAL_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
    PAYPAL_CURRENCY: z.enum(["EUR", "USD"]).default("EUR"),
    XAF_PER_USD: z.coerce.number().positive().default(600),

    // Jobs
    ENABLE_SCHEDULER: bool(true),
    FULL_REFRESH_CRON: z.string().default("5 */3 * * *"),
    SCORES_CRON: z.string().default("*/15 * * * *"),
  })
  .superRefine((e, ctx) => {
    if (!e.PAYMENTS_SANDBOX) {
      if (!e.ENKAP_API_BASE_URL) {
        ctx.addIssue({ code: "custom", path: ["ENKAP_API_BASE_URL"], message: "required when PAYMENTS_SANDBOX=false" });
      } else {
        const apiUrl = z.string().url().safeParse(e.ENKAP_API_BASE_URL);
        if (!apiUrl.success || new URL(e.ENKAP_API_BASE_URL).protocol !== "https:") {
          ctx.addIssue({ code: "custom", path: ["ENKAP_API_BASE_URL"], message: "must be a valid HTTPS URL" });
        }
      }
      const hasAccessToken = Boolean(e.ENKAP_ACCESS_TOKEN);
      const hasConsumerCredentials = Boolean(e.ENKAP_TOKEN_URL && e.ENKAP_CONSUMER_KEY && e.ENKAP_CONSUMER_SECRET);
      const hasApiCredentials = Boolean(e.ENKAP_API_KEY && e.ENKAP_API_SECRET);
      if (!hasAccessToken && !hasConsumerCredentials && !hasApiCredentials) {
        ctx.addIssue({
          code: "custom",
          path: ["ENKAP_ACCESS_TOKEN"],
          message: "required when PAYMENTS_SANDBOX=false; provide ENKAP_ACCESS_TOKEN, or ENKAP_TOKEN_URL + ENKAP_CONSUMER_KEY + ENKAP_CONSUMER_SECRET, or ENKAP_API_KEY + ENKAP_API_SECRET",
        });
      }
    }
    if (e.FOOTBALL_PROVIDER === "api-football" && !e.API_FOOTBALL_KEY) {
      ctx.addIssue({ code: "custom", path: ["API_FOOTBALL_KEY"], message: "required when FOOTBALL_PROVIDER=api-football" });
    }
    if (e.FOOTBALL_PROVIDER === "football-data" && !e.FOOTBALL_DATA_KEY) {
      ctx.addIssue({ code: "custom", path: ["FOOTBALL_DATA_KEY"], message: "required when FOOTBALL_PROVIDER=football-data" });
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";

export const paymentConfig = {
  sandbox: env.PAYMENTS_SANDBOX,
  enkap: Boolean(env.ENKAP_API_BASE_URL && env.ENKAP_ACCESS_TOKEN),
  flutterwave: Boolean(env.FLUTTERWAVE_SECRET_KEY),
  paypal: Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET),
};
