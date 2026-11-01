#!/usr/bin/env node
/* Integration test for the backend. Uses a temporary database and the test-only fake sign-in.
 *   npm test
 */
const os = require("os"), fs = require("fs"), path = require("path"), assert = require("assert");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ollie-test-"));
process.env.DEV_FAKE_AUTH = "1"; process.env.NODE_ENV = "test"; process.env.SESSION_SECRET = "x".repeat(40);
process.env.ADMIN_EMAILS = "boss@example.com"; process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com"; process.env.BASE_URL = "http://localhost:0";
// Exercise the REAL Google verification code with a locally signed token (no network): we only replace the download of Google's public keys.
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const kp = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }), evil = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
OAuth2Client.prototype.getFederatedSignonCertsAsync = async () => ({ certs: { k1: kp.publicKey.export({ type: "spki", format: "pem" }) }, format: "PEM" });
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims, key = kp.privateKey) => { const h = b64({ alg: "RS256", typ: "JWT", kid: "k1" }), p = b64(claims), s = crypto.sign("RSA-SHA256", Buffer.from(h + "." + p), key).toString("base64url"); return h + "." + p + "." + s; };
const nowS = Math.floor(Date.now() / 1000);
const goodClaims = { iss: "https://accounts.google.com", aud: process.env.GOOGLE_CLIENT_ID, sub: "9988776655", email: "real@gmail.com", email_verified: true, name: "Real Person", picture: "https://lh3.googleusercontent.com/a/x", iat: nowS, exp: nowS + 3600 };
const app = require("../server/index.js");
const cfg = require("../server/config");

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log("ok   ", name); } catch (e) { fail++; console.log("FAIL ", name, "\n      ", e.message); } };

const server = app.listen(0, async () => {
  const base = "http://localhost:" + server.address().port;
  process.env.BASE_URL = base; // csrf origin check reads cfg at load; set below via header instead
  class Client {
    constructor() { this.cookie = ""; }
    async call(method, url, body, extra = {}) {
      const r = await fetch(base + url, { method, headers: Object.assign({ "Content-Type": "application/json", "X-Requested-With": "ollie", cookie: this.cookie }, extra), body: body === undefined ? undefined : JSON.stringify(body) });
      const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0].startsWith("ollie_session=;") ? "" : sc.split(";")[0];
      let j = null; try { j = await r.json(); } catch (e) { /* none */ }
      return { status: r.status, body: j };
    }
    login(email, name) { return this.call("POST", "/api/auth/google", { credential: `dev:${email}:${name}` }); }
  }
  const a = new Client(), b = new Client(), boss = new Client(), anon = new Client();

  await t("signed-out /me is null", async () => assert.strictEqual((await anon.call("GET", "/api/me")).body.user, null));
  await t("progress needs sign-in", async () => assert.strictEqual((await anon.call("GET", "/api/progress/progress")).status, 401));
  await t("leaderboard needs sign-in", async () => assert.strictEqual((await anon.call("GET", "/api/leaderboard")).status, 401));
  await t("writes without X-Requested-With are refused (CSRF)", async () => {
    const r = await fetch(base + "/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.strictEqual(r.status, 403);
  });
  await t("bad token rejected", async () => assert.strictEqual((await anon.call("POST", "/api/auth/google", { credential: "garbage" })).status, 401));
  await t("REAL Google check: valid token accepted", async () => { const c = new Client(); const r = await c.call("POST", "/api/auth/google", { credential: jwt(goodClaims) }); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.user.email, "real@gmail.com"); assert.strictEqual((await c.call("GET", "/api/me")).body.user.name, "Real Person"); });
  const bad = (name, claims, key, want = 401) => t("REAL Google check: " + name + " rejected", async () => assert.strictEqual((await new Client().call("POST", "/api/auth/google", { credential: jwt(claims, key) })).status, want));
  await bad("token for a different app (wrong audience)", Object.assign({}, goodClaims, { aud: "someone-else.apps.googleusercontent.com" }));
  await bad("expired token", Object.assign({}, goodClaims, { iat: nowS - 7200, exp: nowS - 3600 }));
  await bad("unverified email", Object.assign({}, goodClaims, { email_verified: false }));
  await bad("wrong issuer", Object.assign({}, goodClaims, { iss: "https://evil.example" }));
  await bad("forged signature", goodClaims, evil.privateKey);
  await t("REAL Google check: domain allow-list enforced", async () => { cfg.allowedDomains = ["corp.com"]; const r = await new Client().call("POST", "/api/auth/google", { credential: jwt(goodClaims) }); cfg.allowedDomains = []; assert.strictEqual(r.status, 403); });
  await t("sign in works and sets a cookie", async () => { const r = await a.login("alice@example.com", "Alice Real"); assert.strictEqual(r.status, 200); assert.ok(a.cookie.startsWith("ollie_session=")); assert.ok(r.body.user.id.length === 20); });
  await t("public id is not the Google id or email", async () => { const r = await a.call("GET", "/api/me"); assert.ok(!r.body.user.id.includes("alice")); });
  await t("tampered cookie is ignored", async () => { const c = new Client(); c.cookie = a.cookie.slice(0, -3) + "abc"; assert.strictEqual((await c.call("GET", "/api/me")).body.user, null); });
  await t("progress round trip", async () => {
    assert.strictEqual((await a.call("GET", "/api/progress/progress")).body.exists, false);
    assert.strictEqual((await a.call("PUT", "/api/progress/progress", { data: { xp: 120, done: { "1a": 1 } } })).status, 200);
    const r = await a.call("GET", "/api/progress/progress"); assert.strictEqual(r.body.data.xp, 120);
  });
  await t("progress is private per account", async () => { await b.login("bob@example.com", "Bob"); assert.strictEqual((await b.call("GET", "/api/progress/progress")).body.exists, false); });
  await t("progress key whitelist", async () => assert.strictEqual((await a.call("PUT", "/api/progress/../../x", { data: {} })).status >= 400, true));
  await t("progress rejects non-objects", async () => assert.strictEqual((await a.call("PUT", "/api/progress/progress", { data: [1] })).status, 400));
  await t("leaderboard is empty until someone opts in", async () => assert.strictEqual((await b.call("GET", "/api/leaderboard")).body.rows.length, 0));
  await t("join board with clamped numbers and sanitised nick", async () => {
    const r = await a.call("PUT", "/api/board", { nick: "  <b>Panda</b>   Pro  ", streak: 99999, best: 5, wk: 50, xp: 12345, today: "2026-10-22", pic: false });
    assert.strictEqual(r.status, 200);
    const l = (await b.call("GET", "/api/leaderboard")).body.rows[0];
    assert.strictEqual(l.nick, "bPanda/b Pro"); // angle brackets stripped
    assert.strictEqual(l.wk, 7); assert.strictEqual(l.streak, 3650); assert.strictEqual(l.pic, "");
    assert.ok(!JSON.stringify(l).includes("alice") && !JSON.stringify(l).includes("Alice"), "no real name or email leaks");
  });
  await t("nick too short refused", async () => assert.strictEqual((await a.call("PUT", "/api/board", { nick: "a" })).status, 400));
  await t("leave board removes the entry", async () => { await a.call("DELETE", "/api/board"); assert.strictEqual((await b.call("GET", "/api/leaderboard")).body.rows.length, 0); });
  await t("two members ranked by week then streak then xp", async () => {
    await a.call("PUT", "/api/board", { nick: "Alice", wk: 3, streak: 3, xp: 100 });
    await b.call("PUT", "/api/board", { nick: "Bob", wk: 5, streak: 1, xp: 10 });
    const rows = (await a.call("GET", "/api/leaderboard")).body.rows; assert.deepStrictEqual(rows.map(r => r.nick), ["Bob", "Alice"]);
  });
  await t("export contains own data only", async () => { const r = await a.call("GET", "/api/export"); assert.strictEqual(r.body.account.email, "alice@example.com"); assert.strictEqual(r.body.progress.length, 1); });
  await t("non-admin cannot read admin stats", async () => assert.strictEqual((await a.call("GET", "/api/admin/stats")).status, 403));
  await t("admin sees stats and can remove an entry", async () => {
    await boss.login("boss@example.com", "Boss");
    const s = await boss.call("GET", "/api/admin/stats"); assert.strictEqual(s.body.users, 4); assert.strictEqual(s.body.onBoard, 2);
    const rows = (await boss.call("GET", "/api/admin/board")).body.rows; assert.strictEqual(rows.length, 2);
    await boss.call("DELETE", "/api/admin/board/" + rows[0].id);
    assert.strictEqual((await boss.call("GET", "/api/admin/stats")).body.onBoard, 1);
  });
  await t("delete account removes everything", async () => {
    assert.strictEqual((await a.call("DELETE", "/api/me")).status, 200);
    assert.strictEqual((await a.call("GET", "/api/me")).body.user, null);
    const again = new Client(); await again.login("alice@example.com", "Alice"); assert.strictEqual((await again.call("GET", "/api/progress/progress")).body.exists, false);
  });
  await t("rate limiting kicks in on sign-in attempts", async () => {
    let limited = false; for (let i = 0; i < 60 && !limited; i++) limited = (await anon.call("POST", "/api/auth/google", { credential: "x" })).status === 429; assert.ok(limited);
  });
  await t("security headers present", async () => {
    const r = await fetch(base + "/healthz"); assert.ok(r.headers.get("content-security-policy").includes("accounts.google.com")); assert.strictEqual(r.headers.get("x-powered-by"), null);
  });
  await t("legal pages are templated", async () => { const r = await (await fetch(base + "/privacy.html")).text(); assert.ok(!r.includes("{{")); assert.ok(r.includes("Privacy notice")); });
  await t("config.json hides secrets", async () => { const j = await (await fetch(base + "/config.json")).json(); assert.ok(!("sessionSecret" in j)); });

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
});
