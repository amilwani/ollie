# Ollie CISA Coach: self-hosting package

Run your own copy of the coach on your own domain, with **Sign in with Google**, **progress synced per account**, and an **opt-in leaderboard**.

```
Browser ──► Caddy (HTTPS) ──► Node app ──► SQLite file (data/coach.db)
                                  │
                                  └─ verifies Google sign-in tokens
```

**What is in the box**

| Part | What it does |
|---|---|
| `public/index.html` | The whole coach app (lessons, quizzes, mocks, flashcards, videos). Works offline once loaded. |
| `public/claude-shim.js` | Connects the app to *your* server: Sign in button, account menu, sync, leaderboard, footer, optional analytics consent. |
| `server/` | Small Express API: Google token check, signed session cookie, progress sync, leaderboard, export/delete, admin, rate limits, security headers. |
| `public/privacy.html`, `terms.html` | Template legal pages (fill-in values come from `.env`). **Have them reviewed.** |
| `server/ai.js` | Optional "Ask Ollie" AI route (`/api/ask`) with sign-in, rate limits and daily caps. Off without `ANTHROPIC_API_KEY`. |
| `public/manifest.webmanifest`, `sw.js`, `icons/` | Install-as-app (PWA) and offline support. |
| `public/admin.html` | Basic admin dashboard (counts, remove a leaderboard entry). |
| `Dockerfile`, `docker-compose.yml`, `Caddyfile` | One-command deploy with automatic HTTPS. |
| `deploy/` | systemd unit and Caddyfile for running without Docker. |
| `scripts/backup.js`, `import-app.js`, `test.js` | Database backup, app update, backend tests. |
| `docs/GOOGLE_SETUP.md` | Click-by-click Google credentials. |
| `docs/CHECKLIST.md` | What is included, and what else to add before you go public. |

**What works and what does not when self-hosted**

- Works: everything that runs in the page (all study features), sign-in, sync across devices, leaderboard, offline use, downloads.
- Optional: the "Ask Ollie" AI tutor (chat, explain in another language, fresh practice questions, weekly coach note). Add your own Anthropic API key to turn it on: [AI_SETUP.md](AI_SETUP.md). Without a key those buttons stay hidden.
- Installable: the site is a PWA, so people can add it to their home screen or desktop and use it offline.

---

## 0. What you need to do yourself

1. **Pick a domain name** (about $10/year) and a **host** (section 2).
2. **Create Google sign-in credentials** (about 10 minutes): [docs/GOOGLE_SETUP.md](GOOGLE_SETUP.md). Nobody else can do this for you because it must be in your Google account.
3. Fill in `.env` (section 1).
4. Review the privacy notice and terms for your country, and fill in your name/contact in `.env`.

## 1. Configure

```bash
cp .env.example .env
# make a session secret and paste it into .env:
openssl rand -hex 32
```

Fill in at least: `BASE_URL`, `GOOGLE_CLIENT_ID`, `SESSION_SECRET`, `ADMIN_EMAILS`, `OPERATOR_NAME`, `CONTACT_EMAIL`.
`BASE_URL` must be exactly the address people use, e.g. `https://coach.example.com` (no trailing slash).

## 2. Deploy

### Option A (recommended): a small server with Docker + automatic HTTPS

Any $4–6/month Linux VPS works (Hetzner, DigitalOcean, Lightsail, Vultr). Choose Ubuntu 24.04.

1. **DNS:** at your domain registrar add an `A` record: `coach` → your server's IP address (or `@` for the bare domain). Wait until `ping coach.example.com` shows your IP.
2. **Install Docker** on the server (SSH in):
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. **Firewall:** allow only SSH, 80 and 443 (`ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable`). Also open 80 and 443 in your provider's firewall panel if it has one.
4. **Upload this folder** to the server (`scp -r ollie-host user@SERVER:~/` or `git clone` your private repo) and `cd` into it.
5. `cp .env.example .env` and fill it in (section 1).
6. Edit `Caddyfile`: replace `coach.example.com` with your domain.
7. Give the container permission to write the database folder, then start:
   ```bash
   mkdir -p data && sudo chown -R 1000:1000 data
   docker compose up -d --build
   docker compose logs -f app     # you should see: "listening on :3000"
   ```
   If the build fails with `429 Too Many Requests` from Docker Hub, build with a mirror of the base image instead:
   ```bash
   docker compose build --build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim && docker compose up -d
   ```
8. Visit `https://your-domain`. The first load may take a few seconds while Caddy gets the certificate.
9. In Google Cloud Console add `https://your-domain` to **Authorized JavaScript origins** (see the Google guide), then try **Sign in**.

### Option B: no Docker (Node + systemd + Caddy)

On an Ubuntu 24.04 server, as root:
```bash
# 1. Node 22 and Caddy
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy

# 2. App
adduser --system --group --home /opt/ollie ollie
# upload this folder's contents to /opt/ollie, then:
cd /opt/ollie && sudo -u ollie npm ci --omit=dev
sudo -u ollie cp .env.example .env && sudo -u ollie nano .env      # fill in (section 1)
sudo -u ollie mkdir -p data

# 3. Run it as a service
cp deploy/ollie.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now ollie
systemctl status ollie

# 4. HTTPS (edit the domain first)
cp deploy/Caddyfile.nodocker /etc/caddy/Caddyfile && systemctl reload caddy
```
Backups: `cd /opt/ollie && sudo -u ollie node scripts/backup.js` (cron it as in section 6, without `docker compose exec`).

### Option C: Vercel (free, serverless)

Import the repository at vercel.com/new and add a Turso database from the Vercel Marketplace. No disk or volume needed. See [VERCEL.md](VERCEL.md).

### Option D: a managed platform (Render, Railway, Fly.io)

Works, but SQLite needs a **persistent disk/volume** mounted at `DATA_DIR` (usually a paid add-on). On free tiers the disk is wiped on every deploy, so accounts and progress would be lost. Use the Dockerfile, set the environment variables from `.env.example` in the dashboard, and mount a volume at `/app/data`. These platforms give you HTTPS and a domain for free; set `TRUST_PROXY=1`.

> Not suitable as-is: static-only hosts (GitHub Pages, Netlify static, S3). They cannot run the sign-in/sync/leaderboard API. You can host only the front end there and the app will still work as a single-device app, but without accounts or leaderboard.

## 3. What was verified before you got this package

Checked here, on the package as shipped: the Docker image builds and runs as a non-root user and writes the mounted `data/` folder; `docker compose` starts the app behind Caddy with HTTPS and an HTTP to HTTPS redirect; the production start-up refuses to run without a session secret; the real Google token checker accepts a valid token and rejects wrong audience, wrong issuer, expired, unverified-email and forged-signature tokens; Google's real public keys can be fetched; the real "Continue with Google" button renders under the site's security policy; sign-in, sync to a second device, leaderboard join/leave, data download, account deletion, analytics opt-in, Save-as-file and the admin page work in a real browser; the systemd unit and Caddyfile pass syntax checks.

**Only you can verify** (needs your Google account, domain and server): a full sign-in with your own Google account, public DNS and the Let's Encrypt certificate on your real domain, and the systemd service on your own VPS. Section 4 is a 5-minute checklist for that.

## 4. Check it works

1. Open the site → top-right **Sign in** → Continue with Google.
2. Do a quiz. Open the site on another device, sign in: your progress is there.
3. **More → Study buddies** → pick a nickname → **Join the board**. A second Google account should see it.
4. Open `/admin.html` (signed in as an `ADMIN_EMAILS` address) for counts and moderation.
5. `curl https://your-domain/healthz` → `{"ok":true}`.

## 5. Privacy by design (how the leaderboard works)

- **Opt-in.** Nobody appears until they press "Join the board". Leaving deletes the entry.
- Other members see only the **nickname the person typed**, study days this week, streak, XP and (optionally) a Google photo. **Never the Google name or email.**
- Public IDs on the board are one-way hashes, not Google IDs.
- Every member can **Download my data** and **Delete my account and data** from the account menu.
- Scores and answers are never sent to the leaderboard.
- Leaderboard numbers come from the browser, so a determined person could fake them. The server clamps values (e.g. 7 days a week), and `/admin.html` can remove entries. For a friendly study board this is fine; do not use it for prizes without server-side tracking.

## 6. Day-to-day operations

**Update the app content** (new version of the coach): replace `app-source/cisa-coach.html` with the new file, then
```bash
npm run import-app -- app-source/cisa-coach.html
# no Node on the server? use a throwaway container instead:
#   docker run --rm -v "$PWD":/w -w /w mirror.gcr.io/library/node:22-bookworm-slim node scripts/import-app.js app-source/cisa-coach.html
docker compose up -d --build    # the page is built into the image, so rebuild (systemd setup: no rebuild needed)
```
Users get the new version on next load. Progress is stored by the app in a compatible way (it merges rather than overwrites).

**Back up** (do this from day one):
```bash
docker compose exec app node scripts/backup.js           # writes data/backups/coach-DATE.db, keeps 14
```
Schedule daily with cron on the server (`crontab -e`):
```
15 3 * * * cd /home/you/ollie-host && docker compose exec -T app node scripts/backup.js
```
Then copy `data/backups/` somewhere else (another provider, object storage, or your laptop with `rsync`). A backup on the same disk is not a backup.
**Restore:** stop the app, copy a backup over `data/coach.db`, delete `data/coach.db-wal` and `data/coach.db-shm`, start the app.

**Update the software:** `git pull` (or upload the new files) → `docker compose up -d --build`. Run `npm audit` now and then.

**Change the domain:** update `Caddyfile`, `.env` (`BASE_URL`), and the Google authorized origin, then restart.

**Run the tests:** `npm install && npm test` (32 checks: uses a temporary database; includes the real Google token-checking code against locally signed tokens, and a test-only fake sign-in that is disabled in production).

## 7. Security notes

- Production refuses to start without a 32+ character `SESSION_SECRET`.
- Sessions are signed, `HttpOnly`, `SameSite=Lax`, and `Secure` over HTTPS. State-changing calls need a custom header plus a same-origin check (CSRF defence).
- Rate limits: 300 requests/min/IP overall, and tighter limits for sign-in, board and sync.
- Content-Security-Policy allows only your own origin plus Google sign-in, Google Fonts and (if configured) your analytics host.
- `DEV_FAKE_AUTH` only works when `NODE_ENV` is not `production`. Never set it on a real server.
- The database is a single SQLite file in `data/`. Keep it out of any public web folder and out of git (already in `.gitignore`).

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Sign-in button missing | `GOOGLE_CLIENT_ID` not set, or the page is blocked from `accounts.google.com`. |
| Google says "origin_mismatch" / "Not a valid origin" | The exact site address is not in **Authorized JavaScript origins** (check `https`, no trailing slash, `www` vs bare). Changes can take a few minutes. |
| "Sign-in failed" after choosing an account | `GOOGLE_CLIENT_ID` on the server differs from the one used by the page, or the server clock is wrong. |
| Signed in but progress/leaderboard fail with 403 | `BASE_URL` does not match the address in the browser. |
| Everyone signed out after a restart | `SESSION_SECRET` is not set or changed. |
| `EACCES` / cannot open database in Docker | `sudo chown -R 1000:1000 data`. |
| Rate limited behind a proxy for everyone at once | Set `TRUST_PROXY=1` (one proxy in front). |

---
*CISA® and ISACA® are registered marks of ISACA. This project is an independent study aid and is not affiliated with ISACA.*
