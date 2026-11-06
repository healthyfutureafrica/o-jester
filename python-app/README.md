# O-Jester — Football Prediction Tips (Python / HTML, FR · EN)

O-Jester publishes daily football prediction tips and ready-made tip combinations built from **real-world fixtures** across 37 leagues. The site is in French and English. It is published by **O-BBLYS Finance Ltd** (RCCM TPPRR/RC/BUA/2026/B/0170).

> **O-Jester is a prediction-tips service, not a betting app.** It never accepts bets, holds stakes or pays out winnings. It is strictly for adults aged 18 and over, and every prediction page says that statistical models and AI can make mistakes.

The app is plain **Python (Flask) + HTML templates + CSS**:

- **No Node.js, no build step, no Claude needed.** All predictions and combinations come from a built-in statistical model (Dixon–Coles Poisson, blended with bookmaker prices).
- **The Claude AI analyst is an optional extra.** It switches on only if you add an `ANTHROPIC_API_KEY`.

## Quick start (Windows)

1. Install Python 3.10 or newer from python.org.
2. Double-click **`start.bat`**. On first run it installs everything and opens `.env` in Notepad.
3. Add your football data key to `.env`:
   - **API-Football** (recommended): all leagues plus bookmaker odds. Sign up at dashboard.api-football.com and set `API_FOOTBALL_KEY=...`.
   - **football-data.org**: free, 12 top competitions, no odds. Set `FOOTBALL_PROVIDER=football-data` and `FOOTBALL_DATA_KEY=...`.
4. Double-click **`start.bat`** again and open **http://localhost:5080**.

On first start the server fetches yesterday's, today's and tomorrow's real fixtures. After that it refreshes every 3 hours, and updates scores every 15 minutes while matches are in play.

Manual commands (inside `python-app`, using `.venv\Scripts\python`):

```
python run.py                                  start the site (Waitress server) + scheduled refresh
python run.py --debug                          development server with auto-reload
python manage.py refresh                       fetch real fixtures & rebuild tips now
python manage.py create-admin EMAIL PASSWORD   create an admin account (access /admin)
python -m pytest                               run the test suite
```

## Put it online for testers

To launch the real app on Render, follow **[GO_LIVE.md](GO_LIVE.md)**. For a test version for friends, see **[BETA_TESTING.md](BETA_TESTING.md)** for step-by-step instructions to put a public beta online, for free, on Render. The beta has:

- a feedback button on every page, with responses visible at `/admin/feedback`;
- a free Elite trial for testers;
- simulated payments.

The guide also includes ready-to-send invitation messages in French and English.

## Production deployment: Kubernetes + Jenkins CI/CD

See **[deploy/README.md](deploy/README.md)**. Every push to `main` goes through the same pipeline:

1. Tests and a security audit.
2. Build and push the Docker image.
3. Deploy to **staging** (the beta), with smoke tests.
4. Wait for **manual approval**.
5. Deploy to **production**, rolling back automatically if anything fails.

Files: `Jenkinsfile`, `jenkins/agent-pod.yaml`, `deploy/k8s/` (Kustomize base, overlays and PostgreSQL component) and `deploy/scripts/deploy.sh`.

## Dependency & deployment files

| File | Purpose |
|---|---|
| `requirements.txt` | Runtime dependencies, pinned to the tested versions |
| `requirements-dev.txt` | Adds the test tools (`pytest`) |
| `.python-version`, `runtime.txt` | Python 3.12 |
| `Dockerfile`, `.dockerignore` | Production container (Waitress, non-root user, health check) |
| `render.yaml` | One-click Render Blueprint: web service plus free PostgreSQL |
| `Procfile` | Start command for Heroku-style hosts |
| `Jenkinsfile`, `jenkins/agent-pod.yaml` | CI/CD pipeline: tests, audit, image build, staging, approval, production |
| `deploy/k8s/` | Kubernetes manifests: Kustomize base, staging and production overlays, PostgreSQL |
| `deploy/scripts/deploy.sh` | Deploy, verify and roll back (used by Jenkins, or by hand) |
| `.env.example` | Every setting, documented |
| `start.bat` | One-click local start on Windows |

## Subscription plans

| | Starter · 1 000 XAF | Pro · 2 000 XAF | Elite VIP · 5 000 XAF |
|---|---|---|---|
| Leagues | Top-5 Europe + Champions League | 19 leagues | All 37 |
| Markets | 1X2 · double chance | + goals · both teams to score | + correct score |
| Daily combinations | 2 | 5 | 9 |
| Tip builder | — | up to 6 picks | unlimited |
| Results history | 3 days | 30 days | full + CSV export |
| Tomorrow's tips | — | — | early access |

Payments are one-off and buy 30 days; nothing renews automatically.

- **Methods:** MTN Mobile Money and Orange Money in XAF, plus Visa/Mastercard, all through Flutterwave. PayPal is charged in EUR, at 1 EUR = 655.957 XAF.
- **Upgrades** convert the unused days of the current plan into credit on the new plan.
- **Sandbox mode** (`PAYMENTS_SANDBOX=true`, the default) simulates checkouts so you can test without real money.

## Legal protections built in

- **Age gate:** every visitor must declare they are 18+ before seeing any content. This is checked on the server and remembered with a cookie.
- **Registration:** requires a date of birth, and the server refuses anyone under 18. Users must also accept the terms and disclaimer.
- **Disclaimers:** every prediction page shows the bar "tips only · AI can make mistakes · 18+", and every AI analysis carries an "AI can make mistakes" notice.
- **Legal notice (FR/EN)** at `/legal` covers:
  - the nature of the service, and that it is not a betting operator;
  - no guarantee, and the limits of AI;
  - a formal warning on gambling by minors;
  - responsible gambling;
  - user responsibility and local law;
  - limitation of liability;
  - subscriptions and privacy.
- **Before launch:**
  - Add your registered address and contact email in `ojester/i18n/legal.json` (`publisher`).
  - Have the notice reviewed by a lawyer licensed in Cameroon.

## Going live

1. Set `APP_ENV=production` and `APP_URL=https://your-domain`, then put the server behind HTTPS.
2. **Flutterwave:** set `FLUTTERWAVE_SECRET_KEY`. In the Flutterwave dashboard, add the webhook `https://your-domain/api/payments/webhooks/flutterwave` and choose a secret hash. Put the same hash in `FLUTTERWAVE_WEBHOOK_HASH`.
3. **PayPal:** set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `PAYPAL_MODE=live`. Add the webhook `https://your-domain/api/payments/webhooks/paypal`, then set `PAYPAL_WEBHOOK_ID`.
4. Set `PAYMENTS_SANDBOX=false`.
5. **Database:** SQLite is used by default (`instance/ojester.db`). For heavier traffic, set `DATABASE_URL` to PostgreSQL.

Every payment is verified directly with the provider before a plan is activated. The amount and currency are checked, and a plan can never be activated twice for the same payment.

## Project layout

```
python-app/
├── run.py · manage.py · start.bat · .env.example
├── requirements.txt · requirements-dev.txt · Dockerfile · render.yaml · Procfile
├── BETA_TESTING.md        how to put the beta online for friends
├── ojester/
│   ├── config.py          settings (a real data provider is mandatory)
│   ├── db.py              database models
│   ├── plans.py · leagues.py
│   ├── football/          API-Football & football-data.org clients
│   ├── predictions/       Poisson / Dixon–Coles model, markets, settlement
│   ├── combos/            daily combination builder
│   ├── pipeline.py        fetch → predict → (optional AI) → combos → settle, scheduler
│   ├── payments/          Flutterwave, PayPal, sandbox
│   ├── ai/                optional Claude analyst (off without an API key)
│   ├── i18n/              en.json · fr.json · legal.json
│   ├── routes/            pages, account, checkout, admin, webhooks
│   ├── templates/         HTML (Jinja2)
│   └── static/            CSS, logo, small JS (copy buttons)
└── tests/
```
