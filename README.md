# O-Jester — AI Football Prediction Tips (FR / EN)

O-Jester analyses **real-world** daily fixtures across 37 major leagues and competitions. Each day it publishes match predictions and ready-made tip combinations. Subscribers can copy them to the platform of their choice.

**O-Jester is a prediction-tips service, not a betting app.** It never accepts bets, holds stakes or pays out winnings. It is strictly reserved for adults aged 18+, and every prediction page reminds users that AI can make mistakes.

- **Real data only.** There is no simulated mode: the server refuses to start without a real match data provider and API key.
- **Fully bilingual (French / English).**
  - The UI, plan descriptions, market labels, match summaries and server error messages are all translated.
  - Claude writes every analysis in both languages.
  - Visitors get their browser language by default and can switch with the FR | EN toggle.
- **Legal protection.**
  - An 18+ age gate appears on first visit.
  - Registration requires a date of birth, and under-18s are rejected **on the server**.
  - Users must accept the terms and disclaimer at signup.
  - A disclaimer bar ("tips only · AI can make mistakes · 18+") shows on every prediction page.
  - A formal legal notice covers: the nature of the service, the absence of any guarantee, the AI limitations, a warning on gambling by minors, responsible gambling, user responsibility and local law, limitation of liability, subscriptions, and privacy.

- **Prediction engine.** A Dixon–Coles Poisson goal model is fed with league tables, home/away splits and form. It is blended with margin-free bookmaker probabilities.
- **AI analyst (Claude).** Claude searches the web for team news (injuries, suspensions, line-ups). It writes a verdict on each fixture (Back / Lean / Avoid), adjusts the confidence score, and removes risky matches from accumulators. Elite users also get an AI risk review of their own slips.
- **Daily combinations.** Nine combo types are built automatically each day, from *Safe Double* to *Mega Accumulator*. Every combo becomes final at 09:00 local time and is settled automatically on the 90-minute score.
- **Three monthly plans.** XAF 1,000, 2,000 and 5,000, payable with MTN MoMo, Orange Money, Visa/Mastercard or PayPal.

---

## Subscription plans

| | **Starter** · 1 000 XAF | **Pro** · 2 000 XAF | **Elite VIP** · 5 000 XAF |
|---|---|---|---|
| Leagues | Top-5 Europe + UCL | + 13 more (UEL, UECL, NED, POR, TUR, BRA, ARG, MLS, KSA…) | All 37 incl. CAF, AFCON, Egypt, Morocco, South Africa, 2nd divisions |
| Markets | 1X2, Double chance | + Over/Under 1.5/2.5/3.5, BTTS | + Correct score |
| Daily combos | Safe Double, Daily Treble | + Goals Galore, BTTS Special, Value Four | + Elite Banker, Mega Acca, Value Five, Correct Score |
| Value edges vs bookmaker | — | ✓ | ✓ |
| AI analysis | — | Summary + key factors | Deep: team news, risks, sources |
| Slip builder | — | Up to 6 picks | Unlimited + AI risk review (10/day) |
| Tomorrow's predictions | — | — | ✓ early access |
| Results history | 3 days | 30 days | Full + CSV export |

Plan rules live in `server/src/config/plans.ts`, which is the single source of truth: the server enforces them and the client renders them. Every API response passes through `server/src/services/views.ts`, so locked data never leaves the server.

**Billing model.** Each payment buys 30 days. Payments are one-off; nothing renews automatically.

- **Renewing** queues 30 more days after the current period ends.
- **Upgrading** starts the new plan immediately. The unused value of the current plan is converted pro-rata into extra days on the new one.
- **Downgrading** queues the lower plan to start when the current period ends.

---

## Architecture

```
O-Jester/
├── server/                    Express 5 + TypeScript + Prisma
│   ├── prisma/schema.prisma   Users, subscriptions, payments, matches, predictions, combos
│   └── src/
│       ├── config/            env validation, plans, league catalogue
│       ├── i18n/              server-side FR/EN messages
│       ├── services/
│       │   ├── football/      providers (API-Football, football-data.org) + ingest
│       │   ├── predictions/   Poisson/Dixon–Coles model, markets, settlement
│       │   ├── combos/        daily combination builder (pure, unit-tested)
│       │   ├── ai/            Claude match analyst + slip reviewer
│       │   ├── payments/      ENKAP hosted checkout and sandbox gateway
│       │   ├── subscriptions.ts
│       │   └── views.ts       plan-gated serialisers
│       ├── jobs/              pipeline + cron scheduler
│       └── routes/            REST API
└── client/                    React 19 + Vite + Tailwind 4 + TanStack Query
```

**Data pipeline.** It runs every 3 hours and on demand from the admin panel:

1. Fetch fixtures for yesterday, today and tomorrow.
2. Fetch bookmaker odds and league tables.
3. Generate predictions.
4. Run AI analysis on the top fixtures (capped per run).
5. Build the combos.
6. Settle finished matches.

A separate score job runs every 15 minutes, but only calls the data provider while matches are in play.

---

## Quick start (local)

Requirements: Node.js 20+.

```bash
npm install
cp server/.env.example server/.env     # then set JWT_SECRET (see the comment in the file)
npm run db:push                        # create the SQLite database
npm run dev                            # API on :4000, web app on http://localhost:5173
```

A **real match data key is required** (see *Going live → 1. Real match data*):

1. Set `FOOTBALL_PROVIDER` and the matching key in `server/.env`.
2. On first boot, the server fetches yesterday's, today's and tomorrow's real fixtures. You can also trigger a fetch at any time with `npm run refresh -w server`.

Payments run in **sandbox** mode by default, so you can test the checkout without charging anyone.

Create an admin account (gives access to `/admin`):

```bash
npm run create-admin -- you@example.com "StrongPassword123" "Your Name"
```

Other commands:

```bash
npm test                         # unit tests (model, markets, combos, dates)
npm run typecheck
npm run refresh -w server        # run the data pipeline once
npm run refresh -w server -- --force   # regenerate today's combos even if final
```

### Before launch: legal checklist

- **Publisher details.** Fill in the company name, trade-register (RCCM) number, address and contact email in `client/src/i18n/legal.ts` (the `PUBLISHER` constant).
- **Lawyer review.** Have the legal notice in `client/src/i18n/legal.ts` (EN + FR) reviewed by a lawyer licensed in Cameroon, and check the local rules for prediction and tipster services.
- **Age gate.** The 18+ gate records each visitor's confirmation in their browser. Registration enforces the age on the server from the date of birth (`server/src/lib/age.ts`).

---

## Going live

### 1. Real match data

Set `FOOTBALL_PROVIDER` in `server/.env`:

| Provider | Setting | Notes |
|---|---|---|
| **API-Football** (recommended) | `api-football` + `API_FOOTBALL_KEY` | Covers every league in the catalogue and includes bookmaker odds, so predictions get data quality **HIGH**. The free plan (100 requests/day, limited seasons) is only enough for testing; production needs a paid plan (from about $19/month). Sign up at dashboard.api-football.com. |
| football-data.org | `football-data` + `FOOTBALL_DATA_KEY` | The free key covers 12 top competitions (Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Champions League, Eredivisie, Primeira Liga, Championship, Brasileirão, World Cup, Euro). It has **no odds**, so the "value" combos and Pro/Elite-only leagues will be empty. Register at football-data.org/client/register. |

League ids are listed in `server/src/config/leagues.ts`. Edit that file to add or remove competitions, for example Cameroon's Elite One.

### 2. AI analysis

Set `ANTHROPIC_API_KEY` (from platform.claude.com). The default model is `claude-opus-5-5`, with web search for team news.

- **Cost control.** `AI_MAX_MATCH_ANALYSES_PER_RUN` (default 20) caps spend. Each fixture is analysed once and refreshed when it is within 8 hours of kick-off.
- **Refusal fallback.** Requests opt into the server-side refusal fallback (`fallbacks: "default"`). If the primary model declines a request, an appropriate fallback model completes it in the same call.
- **Without a key.** The app still works fully on the statistical model.

### 3. Payments

Set `PAYMENTS_SANDBOX=false` when the ENKAP credentials and public callback URLs are ready.

**e-nkap** is the sole live payment provider. Its hosted checkout offers Mobile Money, PayPal and credit/debit card payments, with subscription charges in XAF.

1. Subscribe to the e-nkap Payment API in the Maviance API Manager and copy its sandbox or production API base/context URL (the prefix before `/api/order`).
2. Set `ENKAP_API_BASE_URL` to that API base URL and `ENKAP_ACCESS_TOKEN` to a newly issued server-side access token (raw token, without a `Bearer ` prefix). Keep both out of source control; use the local ignored `server/.env` or your deployment's secret manager.
3. Set `APP_URL` to the public frontend URL and `API_URL` to the public API URL. e-nkap appends the merchant reference to the return and notification URLs sent with each order.
4. Configure the merchant account for Mobile Money, PayPal and Credit Card, then test each method in the e-nkap sandbox before switching to production.

**How payments are confirmed.** Redirects and e-nkap notifications only trigger a server-to-server transaction-details lookup. The server verifies the merchant reference, amount and XAF currency before activating a subscription. Activation is idempotent, so concurrent confirmations activate only once. `PAYMENTS_SANDBOX=true` keeps the in-app mock checkout available for local tests; set it to `false` to require ENKAP credentials and use the live gateway.

### 4. Deploy

```bash
docker build -t o-jester .
docker run -p 4000:4000 --env-file server/.env o-jester
```

In production, the API also serves the built web app, so a single service on one domain is enough. Set `APP_URL` and `API_URL` to that domain. For production data, switch `provider` in `server/prisma/schema.prisma` to `postgresql`, set `DATABASE_URL`, and run `npm run db:push`.

### Security notes

- Sessions use an httpOnly, SameSite=Lax cookie holding a JWT.
- State-changing API calls require a custom header, as a CSRF defence.
- Helmet sets the CSP and other security headers. Auth endpoints and the API are rate-limited.
- Passwords are hashed with bcrypt (cost 12).
- All inputs are validated with zod.

---

## Responsible gambling

O-Jester is a predictions service, not a bookmaker. Users must confirm they are 18 or older at signup, the app shows clear "no guarantees" messaging, and the win probability of every combination is displayed honestly.

Before launch, have the terms in `client/src/pages/Legal.tsx` reviewed by a lawyer in your operating jurisdiction. Check the local rules on betting tipster services.
