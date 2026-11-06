# Put O-Jester online for friends to test

This guide puts the **beta test version** online at a public `https://` address. Friends anywhere can then open it on their phone or computer.

The beta version:

- shows a "test version" banner and a **💬 Feedback** button on every page;
- gives every new account a **free 14-day Elite VIP trial**, so testers can see every feature;
- simulates payments, so **nobody can be charged**;
- is hidden from Google and other search engines.

You read all feedback at **/admin/feedback**. You can filter it by topic and download it as CSV.

Before you start you need:

- **A football data API key.** The app only shows real matches. Either:
  - football-data.org: free, 12 top competitions (register at football-data.org/client/register); or
  - API-Football: all 37 leagues plus bookmaker odds (dashboard.api-football.com).
- **A free GitHub account** (github.com).
- **A free Render account** (render.com). Sign up with your GitHub account.

---

> **Note:** `render.yaml` is now configured for the **real app** (see GO_LIVE.md). For a beta instead, set `BETA_MODE=true` in the Render service's Environment tab, or change it in `render.yaml` before creating the Blueprint.

## Option A — Render (recommended, free, always online)

Expect about 15 minutes, with no software to install besides a browser.

1. **Put the code on GitHub.**
   1. On github.com, click **New repository**. Name it `o-jester` and choose **Private**.
   2. Click **"uploading an existing file"**.
   3. Drag in **everything inside the `python-app` folder**, except `.venv`, `instance` and `.env`.
      - `render.yaml`, `Dockerfile` and `requirements.txt` must be at the top level of the repository.
   4. Click **Commit changes**.

2. **Create the site on Render.**
   1. In the Render dashboard, choose **New → Blueprint** and select your `o-jester` repository.
   2. Render reads `render.yaml` and proposes two things: a web service `o-jester-beta` and a database `o-jester-db`.
   3. When asked for the secret values, fill them in:
      - `FOOTBALL_PROVIDER`: already `api-football`. Change it to `football-data` if you use that key.
      - `API_FOOTBALL_KEY` **or** `FOOTBALL_DATA_KEY`: paste your key. Leave the other one empty.
      - `ADMIN_EMAIL` and `ADMIN_PASSWORD`: your admin login, with a password of 8+ characters. The account is created automatically.
      - `ANTHROPIC_API_KEY`: leave empty. The AI analyst is optional.
   4. Click **Apply**. The first build takes about 5 minutes.

3. **Open your site.** Render gives you an address like `https://o-jester-beta.onrender.com`. Open it and check that today's real matches appear.
   - The first data fetch runs shortly after start-up.
   - You can trigger it again from **/admin** → *Refresh data*.

4. **Log in as admin** with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` you entered. You now have **/admin** and **/admin/feedback**.
   - To change the password later, edit `ADMIN_PASSWORD` in Render's **Environment** tab; the service restarts with the new password.

5. **Send the link to your friends** (message templates below).

**Free-plan limits to know:**

- The site **goes to sleep after 15 minutes without visitors**. The next visitor waits about 30–60 seconds while it wakes up. Tell testers to be patient on the first load.
- Render's free database is deleted **30 days** after creation. Download your feedback CSV before then, or upgrade the database (about $7/month) to keep it.
- While the site sleeps, the scheduled refresh doesn't run. It catches up on the next visit. Use the paid Starter plan (about $7/month) if you need it awake 24/7.

---

## Option B — Share from your own computer (quick test, no accounts)

This works while your PC is on and running O-Jester.

1. Start O-Jester with `start.bat`. For the beta features, set `BETA_MODE=true` in `.env`.
2. Install Cloudflare's free tunnel tool:
   ```
   winget install --id Cloudflare.cloudflared
   ```
3. In a new terminal, run:
   ```
   cloudflared tunnel --url http://localhost:5080
   ```
4. It prints a public address like `https://random-words.trycloudflare.com`. Send that to your friends.
   - Also set `APP_URL` in `.env` to that address and restart O-Jester, so links and cookies use HTTPS.

The address changes each time you restart the tunnel, and testers can only reach the site while your PC is on.

---

## Option C — Any server with Docker

```
docker build -t o-jester .
docker run -d -p 80:5080 --env-file .env --name o-jester o-jester
```

Set `APP_URL` to the server's public `https://` address and `BETA_MODE=true` in `.env`.

---

## Message to send your testers

**Français**

> Salut ! Je lance **O-Jester**, une appli de pronostics football (IA + statistiques) sur les vrais matchs du jour, et j'aimerais ton avis avant le lancement.
> 👉 [LIEN]
> 1. Confirme que tu as 18 ans ou plus, puis crée un compte (gratuit — tu reçois 14 jours d'accès Élite VIP).
> 2. Explore les combinaisons du jour, les matchs, le créateur de combinés et la page Tarifs (les paiements sont simulés, aucun argent n'est débité).
> 3. Clique sur **💬 Votre avis** (en bas à gauche) pour me dire ce qui marche, ce qui bloque et ce que tu changerais.
> Le site peut mettre ~1 minute à s'ouvrir la première fois. Merci beaucoup ! 🙏

**English**

> Hi! I'm launching **O-Jester**, a football prediction-tips app (AI + statistics) built on today's real matches, and I'd love your feedback before launch.
> 👉 [LINK]
> 1. Confirm you're 18 or older, then create an account (free — you get 14 days of Elite VIP access).
> 2. Explore today's combinations, the matches, the tip builder and the pricing page (payments are simulated, no money is taken).
> 3. Tap **💬 Feedback** (bottom left) to tell me what works, what's confusing and what you'd change.
> The site can take ~1 minute to open the first time. Thanks a lot! 🙏

---

## After the beta

When you're ready to launch for real, change these settings in Render (**Environment** tab):

- `BETA_MODE=false`
- `PAYMENTS_SANDBOX=false`
- Your Flutterwave and PayPal keys (see `README.md` → *Going live*)

Also upgrade the database to a paid plan so customer data is kept.
