# Turn on "Ask Ollie" (AI tutor)

The self-hosted coach can use Claude for:

- **Ask Ollie** chat, which knows the topic you are on and your weak areas
- **Explain in another language** and "explain it simpler" buttons in lessons
- **Fresh practice questions** written on demand for a topic
- A short **weekly coach note** on the progress page

It is off until you add an Anthropic API key. Without a key the AI buttons simply stay hidden.

## 1. Get a key (5 minutes)

1. Go to <https://console.anthropic.com>, sign in and add a payment method under **Billing**.
2. **Settings → Limits**: set a monthly spend limit you are comfortable with. This is your hard ceiling.
3. **API keys → Create key**. Copy it (it starts with `sk-ant-`).

## 2. Add it to `.env`

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Restart the app (`docker compose up -d` or `systemctl restart ollie`). Signed-in members now see **✦ Ask Ollie**.

The key stays on your server. Browsers only talk to `/api/ask` on your site, which checks the member and the limits before calling Anthropic.

## 3. Spending guards (already on)

| Setting | Default | Meaning |
|---|---|---|
| `AI_REQUIRE_SIGNIN` | `true` | Only signed-in members can use AI. Keep this on for a public site. |
| `AI_PER_MINUTE` | `10` | Requests per minute per visitor. |
| `AI_DAILY_PER_USER` | `40` | Requests per member per day (UTC). |
| `AI_DAILY_SITE` | `1000` | Requests per day for the whole site. When reached, AI pauses until tomorrow. |
| `AI_MAX_TOKENS` | `2000` | Longest answer allowed. |
| `AI_MODEL` | `claude-opus-5-5` | Model used. |
| `AI_EFFORT` | `low` | How hard the model thinks. `low` keeps answers fast and cheap; `medium`/`high` are more thorough. |

Rough cost: a typical tutor answer uses a few thousand input tokens (lesson context) and a few hundred output tokens, so about two US cents per answer on the default model. With the defaults, one very active member costs at most about 80 cents a day, and the site-wide cap bounds the total. Check the Anthropic Console's **Usage** page in the first week and adjust.

Today's AI request count is shown on `/admin.html`.

## Privacy

Questions typed into Ask Ollie, and the study context sent with them, go to Anthropic to generate the answer. They are not stored on your server; only a per-day request count is kept. The privacy notice template already says this. Review it before going public.
