# Go live on Render (real app)

This launches O-Jester publicly at **https://www.o-jester.com** (and the Render address **https://o-jester.onrender.com**):

- real matches;
- your admin account;
- **payments simulated** until Flutterwave/PayPal approve your business accounts.

It takes about 20 minutes.

## Before you start

1. **A football data API key.** The app shows real matches only. Choose one:
   - **API-Football** (recommended for a real app): all 37 leagues plus bookmaker odds. The free plan (100 requests per day, limited seasons) is only for testing, so pick a **paid plan**. Sign up at dashboard.api-football.com → copy your API key.
   - **football-data.org:** free key, 12 top competitions, no odds. The value combos and the Pro/Elite-only leagues will be mostly empty.
2. **A Render account** at render.com. Sign up with GitHub and add a payment card, because the plans below are paid.
3. **GitHub access:** Render must be able to read `obblysfinanceltd-byte/o-jester`. When Render asks to install its GitHub app, choose the **obblysfinanceltd-byte** account and allow access to the `o-jester` repository.

## Deploy

1. In the Render dashboard, choose **New → Blueprint**, pick **o-jester**, and click **Connect**.
2. Render reads `render.yaml` and shows what it will create, with prices:
   - web service **o-jester** (plan 0.5c-512mb, Frankfurt);
   - PostgreSQL **o-jester-db** (plan 0.1c-256mb, Frankfurt).
3. Fill in the secret values:

   | Setting | Value |
   |---|---|
   | `FOOTBALL_PROVIDER` | `api-football` or `football-data` (whichever key you have) |
   | `API_FOOTBALL_KEY` | your API-Football key (leave empty if you use football-data.org) |
   | `FOOTBALL_DATA_KEY` | your football-data.org key (leave empty if you use API-Football) |
   | `ADMIN_EMAIL` / `ADMIN_PASSWORD` | your admin login (password 8+ characters) |
   | Flutterwave / PayPal fields | **leave empty for now** (payments are simulated) |
   | `ANTHROPIC_API_KEY` | leave empty (the AI analyst is optional) |

4. Click **Apply**. The first build takes 5–10 minutes. Wait until the service shows **Live**.

## Check it works

1. Open **https://o-jester.onrender.com** (Render shows the exact address on the service page) and confirm 18+.
2. Log in with your admin email and password, then open **/admin**:
   - **Pipeline runs** should show `full-refresh` with status **ok**.
   - The first fetch starts a few seconds after start-up. Use **Refresh data** to run it again.
3. **Matches** shows today's real fixtures with predictions.
4. Register a normal test account. Buy a plan with the **simulated** checkout ("Approve payment") and check that the combos unlock.

If `full-refresh` shows **failed**, the message usually means the API key is wrong or out of quota. Open the service → **Environment**, fix the key, and save; the service restarts.

## Connect www.o-jester.com

`o-jester.com` is registered at **Hostinger**. Do these two parts in order.

**1. In Render.** Open the **o-jester** service → **Settings → Custom Domains → Add Custom Domain** and enter `www.o-jester.com`. Render also adds `o-jester.com` and redirects it to `www.`.

**2. In Hostinger.** Go to **hPanel → Domains → o-jester.com → DNS / Nameservers → DNS records**:

| Action | Type | Name | Points to / Value | TTL |
|---|---|---|---|---|
| Delete | A | `@` | `2.57.91.91` (the parking page) | — |
| Delete | CNAME | `www` | `o-jester.com` | — |
| Delete | AAAA | any | any (Render needs IPv4 only) | — |
| **Add** | **A** | `@` | `216.24.57.1` | 3600 |
| **Add** | **CNAME** | `www` | `o-jester.onrender.com` | 3600 |

Use the exact address your service page shows if it isn't `o-jester.onrender.com`.

**3. Verify.** Back in Render, click **Verify** next to each domain. DNS changes usually take a few minutes, but can take up to 24–48 hours. Render then issues the HTTPS certificate automatically. When both domains show **Certificate issued**, **https://www.o-jester.com** is live.

`APP_URL` is already set to `https://www.o-jester.com` in `render.yaml`. Until the domain works, the site stays fully usable at the `onrender.com` address, and payment redirects follow whichever address the visitor is on.

## When payments are approved (later)

In the service → **Environment**:

1. Add `FLUTTERWAVE_SECRET_KEY` and `FLUTTERWAVE_WEBHOOK_HASH`, and/or `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `PAYPAL_WEBHOOK_ID`.
2. Set `PAYMENTS_SANDBOX` to `false`.
3. Register the webhooks:
   - Flutterwave: `https://www.o-jester.com/api/payments/webhooks/flutterwave`
   - PayPal: `https://www.o-jester.com/api/payments/webhooks/paypal`

**Important:** until you do this, the simulated checkout gives access for free. Anyone can unlock a plan without paying.

## Everyday operation

- **Updates:** every `git push` to `main` redeploys automatically. Render keeps the previous version running until the new one passes its health check.
- **Logs:** service → **Logs**.
- **Backups:** paid Render Postgres instances are backed up automatically. You can also download one from the database page.
