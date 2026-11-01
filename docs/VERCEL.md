# Deploy Ollie on Vercel (about 20 minutes)

Vercel runs the app for free on the Hobby plan: the app itself is served from Vercel's CDN, and the
sign-in, progress sync, leaderboard and Ask Ollie API runs as one serverless function (`api/index.js`).

Vercel's disk is wiped between requests, so accounts and progress live in a free hosted
**Turso** database (SQLite-compatible, added from the Vercel Marketplace in two clicks).
Without it the site still opens and works as a single-device app, but anything saved on the server is lost.

## 1. Import the repository
1. Go to <https://vercel.com/new> and sign in with GitHub.
2. Under **Import Git Repository**, pick **amilwani/ollie** → **Import**.
   (If it is not listed: **Adjust GitHub App Permissions** and give Vercel access to the repo.)
3. Leave **Framework Preset: Other** and the build settings as they are; `vercel.json` sets them.
4. Open **Environment Variables** and add the ones in step 3 below that you already have
   (at least `SESSION_SECRET`). You can add the rest later.
5. **Deploy**. You get an address like `https://ollie-xxxx.vercel.app`.

## 2. Add the database (Turso)
1. In the project: **Storage → Create Database → Turso** (Marketplace) → accept → pick the free plan and a region close to your users → **Create**.
2. Connect it to the project for **Production** and **Preview**. This adds `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` automatically.
3. **Deployments → ⋯ on the latest → Redeploy** so the new variables take effect. The tables are created on the first request.

(Already have a Turso account? Create a database there, then add `TURSO_DATABASE_URL` (`libsql://...`) and `TURSO_AUTH_TOKEN` by hand.)

## 3. Environment variables
**Settings → Environment Variables**. Redeploy after changing them.

| Name | Required | Value |
|---|---|---|
| `SESSION_SECRET` | yes | 64 random characters: `openssl rand -hex 32`. Changing it signs everyone out. |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | yes | Added by the Turso integration (step 2). |
| `GOOGLE_CLIENT_ID` | for sign-in | From [GOOGLE_SETUP.md](GOOGLE_SETUP.md). |
| `BASE_URL` | if you use a custom domain | e.g. `https://ollie.yourdomain.com`. Defaults to the project's production `*.vercel.app` address. |
| `ADMIN_EMAILS` | optional | Google emails that may open `/admin.html`. |
| `SITE_NAME`, `OPERATOR_NAME`, `CONTACT_EMAIL` | recommended | Shown in the footer, privacy notice and terms. |
| `ANTHROPIC_API_KEY` | optional | Turns on Ask Ollie. See [AI_SETUP.md](AI_SETUP.md) for the spending caps. |
| `ALLOWED_EMAIL_DOMAINS`, `SESSION_DAYS`, `AI_*` | optional | Same meaning as in `.env.example`. |

Not needed on Vercel: `PORT`, `NODE_ENV`, `DATA_DIR`, `TRUST_PROXY`.

## 4. Google sign-in
In Google Cloud → **Credentials → your OAuth client → Authorized JavaScript origins**, add the
production address exactly, e.g. `https://ollie-xxxx.vercel.app` (and your custom domain if you add one).
Sign-in works on the production address only: preview deployments have their own addresses and are
refused by both Google and the app's request-origin check.

## 5. Check it
- `https://<your-address>/healthz` shows `{"ok":true}`.
- Sign in, answer a quiz question, then open the site on another device: your progress follows you.
- **Deployments → a deployment → Functions/Logs** shows any warning such as a missing variable.

## Good to know
- Every push to `main` redeploys automatically; pull requests get preview deployments.
- Custom domain: **Settings → Domains**, then set `BASE_URL` and add the domain to Google's origins.
- Backups: Turso keeps point-in-time backups on its side. To take a copy: `turso db shell <db> .dump > backup.sql`.
- Rate limits are counted per function instance, so they are looser than on a single server.
  The daily Ask Ollie caps are stored in the database and still hold exactly.
- Ask Ollie answers stream for up to 60 seconds per request (`maxDuration` in `vercel.json`).
- Using the optional analytics script (`ANALYTICS_SRC`)? Add its origin to `script-src` and `connect-src`
  in the `Content-Security-Policy` header in `vercel.json`, or the browser will block it.
