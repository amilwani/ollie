#!/usr/bin/env node
/* Tests for the optional "Ask Ollie" AI route, against a local fake of the Anthropic streaming API (no real key, no network).
 *   npm test
 */
const os = require("os"), fs = require("fs"), path = require("path"), http = require("http"), assert = require("assert");

const calls = [];
const fake = http.createServer((req, res) => {
  let body = ""; req.on("data", c => body += c); req.on("end", () => {
    const j = JSON.parse(body); calls.push({ headers: req.headers, body: j });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(Object.assign({ type }, data))}\n\n`);
    const reply = j.system.includes("valid JSON") ? '[{"q":"Q?","correct":"A","wrong":["B","C","D"],"why":"Because."}]' : "Hello from Ollie.";
    ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: j.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } });
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    for (const part of reply.match(/.{1,6}/g)) ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: part } });
    ev("content_block_stop", { index: 0 });
    ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 7 } });
    ev("message_stop", {});
    res.end();
  });
});

fake.listen(0, () => {
  process.env.ANTHROPIC_BASE_URL = "http://localhost:" + fake.address().port;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.AI_DAILY_PER_USER = "2";
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ollie-ai-test-"));
  process.env.DEV_FAKE_AUTH = "1"; process.env.NODE_ENV = "test"; process.env.SESSION_SECRET = "y".repeat(40);
  const app = require("../server/index.js");
  const { cleanMessages } = require("../server/ai");

  let pass = 0, fail = 0;
  const t = async (name, fn) => { try { await fn(); pass++; console.log("ok   ", name); } catch (e) { fail++; console.log("FAIL ", name, "\n      ", e.message); } };
  const server = app.listen(0, async () => {
    const base = "http://localhost:" + server.address().port;
    let cookie = "";
    const ask = async (body, withCookie = true) => {
      const r = await fetch(base + "/api/ask", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "ollie", cookie: withCookie ? cookie : "" }, body: JSON.stringify(body) });
      const text = await r.text();
      return { status: r.status, lines: text.split("\n").filter(Boolean).map(l => JSON.parse(l)) };
    };

    await t("config.json advertises AI without the key", async () => { const j = await (await fetch(base + "/config.json")).json(); assert.deepStrictEqual(j.ai, { requireSignIn: true }); assert.ok(!JSON.stringify(j).includes("test-key")); });
    await t("AI needs sign-in by default", async () => assert.strictEqual((await ask({ prompt: "hi" }, false)).status, 401));
    const login = await fetch(base + "/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "ollie" }, body: JSON.stringify({ credential: "dev:ai@example.com:AI Tester" }) });
    cookie = login.headers.get("set-cookie").split(";")[0];
    await t("bad requests are refused", async () => {
      assert.strictEqual((await ask({ messages: [{ role: "system", content: "x" }] })).status, 400);
      assert.strictEqual((await ask({ prompt: "x".repeat(50000) })).status, 200 /* trimmed to 12k chars */ );
    });
    await t("streams text back from Claude", async () => {
      const r = await ask({ messages: [{ role: "user", content: "Explain CIA triad" }] });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.lines.filter(l => l.d).map(l => l.d).join(""), "Hello from Ollie.");
      assert.ok(r.lines.some(l => l.done));
      const last = calls[calls.length - 1];
      assert.ok(last.headers["x-api-key"] === "test-key" || last.headers.authorization === "Bearer test-key");
      assert.strictEqual(last.body.model, "claude-opus-5-5");
      assert.ok(last.body.max_tokens <= 2000);
    });
    await t("daily per-member cap", async () => assert.strictEqual((await ask({ prompt: "again" })).status, 429));
    await t("message cleaning merges turns and needs a final user turn", async () => {
      assert.deepStrictEqual(cleanMessages({ messages: [{ role: "user", content: "a" }, { role: "user", content: "b" }] }), [{ role: "user", content: "a\n\nb" }]);
      assert.strictEqual(cleanMessages({ messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] }), null);
    });

    console.log(`\n${pass} passed, ${fail} failed`);
    server.close(); fake.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
    process.exit(fail ? 1 : 0);
  });
});
