# What should be in the package (and what still needs you)

✅ = included in this package · 🟡 = included in basic form · ☐ = recommended, not included yet

## Must do before you share the link publicly

| | Item | Notes |
|---|---|---|
| ✅ | **HTTPS + custom domain** | Caddy gets and renews certificates automatically (README step 2A). |
| ✅ | **Google sign-in, per-account sync** | docs/GOOGLE_SETUP.md. |
| 🟡 | **Privacy notice and terms** | Templates at `/privacy.html` and `/terms.html`, filled from `.env`. **Get them reviewed for your country** (GDPR/UK GDPR/CCPA/India DPDP). They are not legal advice. |
| ✅ | **ISACA non-affiliation notice** | Footer on every page and in the terms. |
| ☐ | **Check the content you publish** | Make sure no text is copied from ISACA's CISA Review Manual, QAE database or any real exam. An automated overlap check I ran on the current app text against the Review Manual text I had found 1 stock definition (8 words) out of ~5,000 text blocks. It cannot check material I do not have (the QAE PDF is image-only). Publishing your own explanations and original questions is fine; copying ISACA's text is not. |
| ✅ | **Backups** | `npm run backup` + cron (README section 6). **You** must copy backups off the server. |
| ✅ | **Rate limiting, security headers, CSRF defence** | Built in. |
| ✅ | **Account deletion and data export** | Account menu. Needed for GDPR-style rights. |
| ✅ | **Analytics opt-in** | Off by default. Set `ANALYTICS_SRC` (e.g. Plausible/Umami) and visitors get an Allow / No thanks bar. Nothing loads before they agree. |
| ☐ | **Uptime monitoring** | Free: UptimeRobot / Better Stack on `https://your-domain/healthz`. Takes 2 minutes. |

## Strongly recommended soon

| | Item | Notes |
|---|---|---|
| 🟡 | **Admin view** | `/admin.html`: user counts, active users, remove a leaderboard entry. Not included: banning users, search, audit log. |
| ☐ | **Leaderboard report button / profanity filter** | Today you moderate by removing entries in admin. Add a "Report" button and a word filter if the audience grows. |
| ☐ | **Server-side leaderboard numbers** | Numbers are reported by the browser (clamped, but fakeable). Fine for friends; compute on the server before offering prizes. |
| ☐ | **Error tracking** | Sentry (free tier) for the server and the page. |
| ☐ | **Staging copy** | A second small deployment + a second Google client ID to test updates before production. |
| ☐ | **Automated off-site backup** | e.g. `rclone` to Backblaze B2 / S3 from cron. |
| ☐ | **Restore drill** | Once, try restoring a backup on another machine. Untested backups are guesses. |
| ☐ | **Email** | "Contact" address that you actually read; optional weekly digest emails need an email service (Resend, Postmark, SES) and unsubscribe handling. |
| ☐ | **Terms acceptance record** | A checkbox at first sign-in storing the accepted version/date, if your lawyer wants it. |
| ☐ | **Cookie/consent review** | With analytics off, only the sign-in cookie (strictly necessary) is used. If you add other trackers or ads, you need a full consent manager. |
| ☐ | **Admin 2-step protection** | Admin rights follow Google sign-in. Turn on 2-step verification on every admin Google account. |
| ☐ | **Log retention policy** | Decide how long web server logs are kept (e.g. 30 days) and say so in the privacy notice. |

## Nice to have

- ✅ AI features (Ask Ollie, explain in another language, new practice questions): included, off until you set `ANTHROPIC_API_KEY` (docs/AI_SETUP.md). Also set a monthly spend limit in the Anthropic Console.
- ✅ Install-to-home-screen (PWA manifest + service worker): included.
- A public "What's new" page and in-app feedback form.
- Study groups: private boards by invite code instead of one global board.
- Email/Apple/Microsoft sign-in options in addition to Google.
- Multi-instance scale: move SQLite → Postgres (only needed above thousands of daily users).
- ✅ CI: `npm test` runs on every push and pull request (GitHub Actions). Not included yet: publishing a Docker image on release.
- Content licensing page: credits, how to report an error, version number and "last reviewed" date shown in the footer.
- Accessibility statement and a periodic WCAG check (the app already supports keyboard use and dark mode).

## Setup that only you can do

1. Buy/choose a **domain** and create the DNS `A` record.
2. Create the **VPS** (or platform account) and add a payment method.
3. Create **Google OAuth credentials** and add your domain as an authorized origin.
4. Fill in `.env` (client ID, session secret, your name and contact email).
5. Review/adapt **privacy and terms**; decide your analytics and data-retention choices.
6. Set up **off-site backups** and uptime monitoring.
