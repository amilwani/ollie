// "Ask Ollie" AI features (tutor chat, explain-in-another-language, new practice questions, weekly note).
// Off unless ANTHROPIC_API_KEY is set. The key stays on the server; the browser only talks to /api/ask.
// Spending is bounded by: sign-in requirement, per-minute rate limit, per-member daily cap, site-wide daily cap,
// request size limits and max_tokens.
const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const cfg = require("./config");
const db = require("./db");

// usage counts live in the ai_usage table (created in db.js)

const SYSTEM = `You are Ollie, a calm, warm panda study coach inside a CISA exam study app.
Help the learner understand information systems audit concepts in your own words.
Do not reproduce text from ISACA publications or real exam questions; write original explanations and questions.
Ollie is an independent study aid and is not affiliated with ISACA. If asked about exam rules, fees or dates, suggest checking isaca.org.
Keep answers focused and reasonably short unless the learner asks for more.`;

let client = null;
function getClient() {
  if (!client) { const Anthropic = require("@anthropic-ai/sdk"); client = new Anthropic({ apiKey: cfg.ai.apiKey, maxRetries: 1 }); }
  return client;
}

const today = () => new Date().toISOString().slice(0, 10);
const used = async (who) => ((await db.get("SELECT n FROM ai_usage WHERE day = ? AND who = ?", today(), who)) || { n: 0 }).n;
const usedAll = async () => (await db.get("SELECT COALESCE(SUM(n),0) n FROM ai_usage WHERE day = ?", today())).n;
const bump = (who) => db.run("INSERT INTO ai_usage (day, who, n) VALUES (?, ?, 1) ON CONFLICT(day, who) DO UPDATE SET n = n + 1", today(), who);

// Messages from the app: a single prompt string or a list of {role, content} turns.
function cleanMessages(body) {
  let turns = body && (typeof body.prompt === "string" ? [{ role: "user", content: body.prompt }] : body.messages);
  if (!Array.isArray(turns) || !turns.length || turns.length > 30) return null;
  let total = 0;
  const out = [];
  for (const t of turns) {
    if (!t || (t.role !== "user" && t.role !== "assistant") || typeof t.content !== "string") return null;
    const c = t.content.slice(0, 12000); total += c.length;
    if (!c.trim()) continue;
    // merge consecutive same-role turns so the request is always well formed
    if (out.length && out[out.length - 1].role === t.role) out[out.length - 1].content += "\n\n" + c; else out.push({ role: t.role, content: c });
  }
  if (!out.length || total > 40000 || out[0].role !== "user" || out[out.length - 1].role !== "user") return null;
  return out;
}

function router({ currentUser }) {
  const r = express.Router();
  r.use(rateLimit({ windowMs: 60 * 1000, max: cfg.ai.perMinute, standardHeaders: true, legacyHeaders: false, message: { error: "rate_limited" } }));

  r.post("/", async (req, res, next) => {
    if (!cfg.ai.enabled) return res.status(503).json({ error: "ai_off" });
    let u, who, over;
    try {
      u = await currentUser(req);
      if (!u && cfg.ai.requireSignIn) return res.status(401).json({ error: "signed_out" });
      who = u ? u.id : "ip:" + crypto.createHash("sha256").update(cfg.sessionSecret + req.ip).digest("hex").slice(0, 16);
      over = (await used(who)) >= cfg.ai.perUserDaily ? "daily_limit" : (await usedAll()) >= cfg.ai.siteDaily ? "site_daily_limit" : "";
    } catch (e) { return next(e); }
    if (over) return res.status(429).json({ error: "rate_limited", why: over });
    const messages = cleanMessages(req.body);
    if (!messages) return res.status(400).json({ error: "bad_request" });
    const wantJson = !!(req.body && req.body.json);
    try { await bump(who); } catch (e) { return next(e); }

    res.status(200);
    res.set({ "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    const send = o => res.write(JSON.stringify(o) + "\n");
    const ctl = new AbortController();
    res.on("close", () => { if (!res.writableEnded) ctl.abort(); });

    let text = "";
    try {
      const stream = getClient().beta.messages.stream({
        model: cfg.ai.model,
        max_tokens: cfg.ai.maxTokens,
        system: SYSTEM + (wantJson ? "\nReply with only valid JSON, no code fences and no extra text." : ""),
        output_config: { effort: cfg.ai.effort },
        messages,
        // If a request is declined by a safety classifier, let the API retry it on a suitable model.
        ...(cfg.ai.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {})
      }, { signal: ctl.signal });
      for await (const ev of stream) {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") { text += ev.delta.text; send({ d: ev.delta.text }); }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") send({ error: "declined" });
      send({ done: true, text });
    } catch (e) {
      if (ctl.signal.aborted) return res.end();
      const status = e && e.status;
      console.error("ask failed:", status || "", e && e.message);
      send({ error: status === 429 || status === 529 ? "rate_limited" : "ai_error" });
    }
    res.end();
  });
  return r;
}

module.exports = { router, cleanMessages };
