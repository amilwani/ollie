const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { OAuth2Client } = require("google-auth-library");
const cfg = require("./config");
const db = require("./db");
const session = require("./session");
const ai = require("./ai");

const app = express();
app.set("trust proxy", cfg.trustProxy);
app.disable("x-powered-by");

const analyticsOrigin = cfg.analyticsSrc ? [new URL(cfg.analyticsSrc).origin] : [];

// ---------- security headers ----------
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://accounts.google.com", ...analyticsOrigin],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://accounts.google.com"],
      fontSrc: ["https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.googleusercontent.com"],
      connectSrc: ["'self'", "https://accounts.google.com", "https://fonts.googleapis.com", "https://fonts.gstatic.com", ...analyticsOrigin],   // fonts: fetched by the offline service worker
      frameSrc: ["https://accounts.google.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"]
    }
  },
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },   // needed by the Google sign-in popup
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  hsts: cfg.prod && cfg.baseUrl.startsWith("https") ? { maxAge: 31536000, includeSubDomains: true } : false
}));

// ---------- helpers ----------
const now = () => Date.now();
const pubId = uid => crypto.createHmac("sha256", cfg.sessionSecret).update("pub:" + uid).digest("hex").slice(0, 20);
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v || 0)));
const KEY_RE = /^progress(-p\d{1,2})?$/;
const isAdmin = u => !!u && cfg.adminEmails.includes(String(u.email).toLowerCase());
const verifier = cfg.googleClientId ? new OAuth2Client(cfg.googleClientId) : null;
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const publicUser = u => ({ id: pubId(u.id), name: u.name, picture: u.picture, email: u.email, admin: isAdmin(u) });

function currentUser(req) {
  const uid = session.read(req);
  return uid ? db.prepare("SELECT * FROM users WHERE id = ?").get(uid) || null : null;
}
function needUser(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: "signed_out" });
  req.user = u; next();
}
function needAdmin(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: "signed_out" });
  if (!isAdmin(u)) return res.status(403).json({ error: "not_admin" });
  req.user = u; next();
}
// CSRF defence for cookie auth: SameSite=Lax cookie + custom header + same-origin Origin check on writes.
function csrf(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD") return next();
  if (req.get("x-requested-with") !== "ollie") return res.status(403).json({ error: "bad_request_origin" });
  const o = req.get("origin");
  if (o && o !== new URL(cfg.baseUrl).origin) return res.status(403).json({ error: "bad_origin" });
  next();
}
const limiter = (windowMs, max) => rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { error: "rate_limited" } });

// ---------- API ----------
const api = express.Router();
api.use(limiter(60 * 1000, 300));
api.use(csrf);
api.use(express.json({ limit: "2mb" }));

api.get("/me", (req, res) => {
  const u = currentUser(req);
  if (!u) return res.json({ user: null });
  db.prepare("UPDATE users SET last_seen = ? WHERE id = ?").run(now(), u.id);
  res.json({ user: publicUser(u) });
});

api.post("/auth/google", limiter(15 * 60 * 1000, 40), async (req, res) => {
  const cred = req.body && req.body.credential;
  if (typeof cred !== "string" || cred.length > 4096) return res.status(400).json({ error: "bad_credential" });
  let p;
  try {
    if (cfg.devAuth && cred.startsWith("dev:")) {
      const [, email, name] = cred.split(":");
      p = { sub: "dev-" + email, email, email_verified: true, name: name || email, picture: "" };
    } else {
      if (!verifier) return res.status(503).json({ error: "not_configured" });
      const t = await verifier.verifyIdToken({ idToken: cred, audience: cfg.googleClientId });
      p = t.getPayload();
    }
  } catch (e) { return res.status(401).json({ error: "invalid_token" }); }
  if (!p || !p.sub || !p.email || p.email_verified !== true) return res.status(401).json({ error: "email_not_verified" });
  if (cfg.allowedDomains.length && !cfg.allowedDomains.includes(String(p.email).split("@")[1].toLowerCase())) return res.status(403).json({ error: "domain_not_allowed" });
  const t = now();
  db.prepare(`INSERT INTO users (id,email,name,picture,created,last_seen) VALUES (?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, picture=excluded.picture, last_seen=excluded.last_seen`)
    .run(p.sub, p.email, String(p.name || "").slice(0, 120), String(p.picture || "").slice(0, 400), t, t);
  session.set(res, p.sub);
  res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(p.sub)) });
});

api.post("/auth/logout", (req, res) => { session.clear(res); res.json({ ok: true }); });

// per-account progress (the app stores one JSON document per study profile)
api.get("/progress/:key", needUser, (req, res) => {
  if (!KEY_RE.test(req.params.key)) return res.status(400).json({ error: "bad_key" });
  const r = db.prepare("SELECT data, updated FROM progress WHERE uid = ? AND key = ?").get(req.user.id, req.params.key);
  if (!r) return res.json({ exists: false });
  res.json({ exists: true, updated: r.updated, data: JSON.parse(r.data) });
});
api.put("/progress/:key", needUser, limiter(60 * 1000, 120), (req, res) => {
  if (!KEY_RE.test(req.params.key)) return res.status(400).json({ error: "bad_key" });
  const d = req.body && req.body.data;
  if (!d || typeof d !== "object" || Array.isArray(d)) return res.status(400).json({ error: "bad_data" });
  const n = db.prepare("SELECT COUNT(*) c FROM progress WHERE uid = ?").get(req.user.id).c;
  const have = db.prepare("SELECT 1 FROM progress WHERE uid = ? AND key = ?").get(req.user.id, req.params.key);
  if (!have && n >= 12) return res.status(400).json({ error: "too_many_profiles" });
  db.prepare(`INSERT INTO progress (uid,key,data,updated) VALUES (?,?,?,?)
    ON CONFLICT(uid,key) DO UPDATE SET data=excluded.data, updated=excluded.updated`)
    .run(req.user.id, req.params.key, JSON.stringify(d), now());
  res.json({ ok: true });
});

// leaderboard (opt-in: a row exists only after the member joins)
const cleanNick = s => String(s || "").normalize("NFKC").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 20);
api.get("/leaderboard", needUser, (req, res) => {
  const rows = db.prepare(`SELECT b.uid, b.nick, b.show_pic, b.streak, b.best, b.wk, b.xp, b.today, u.picture
    FROM board b JOIN users u ON u.id = b.uid ORDER BY b.wk DESC, b.streak DESC, b.xp DESC LIMIT 200`).all();
  res.json({ rows: rows.map(r => ({ id: pubId(r.uid), nick: r.nick, pic: r.show_pic && /^https:\/\/[^\s"'<>]+$/.test(r.picture || "") ? r.picture : "", streak: r.streak, best: r.best, wk: r.wk, xp: r.xp, today: r.today })) });
});
api.put("/board", needUser, limiter(60 * 1000, 60), (req, res) => {
  const b = req.body || {}, nick = cleanNick(b.nick);
  if (nick.length < 2) return res.status(400).json({ error: "bad_nick" });
  db.prepare(`INSERT INTO board (uid,nick,show_pic,streak,best,wk,xp,today,upd) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(uid) DO UPDATE SET nick=excluded.nick, show_pic=excluded.show_pic, streak=excluded.streak, best=excluded.best,
      wk=excluded.wk, xp=excluded.xp, today=excluded.today, upd=excluded.upd`)
    .run(req.user.id, nick, b.pic ? 1 : 0, clampInt(b.streak, 0, 3650), clampInt(b.best, 0, 3650), clampInt(b.wk, 0, 7), clampInt(b.xp, 0, 5e6),
      /^\d{4}-\d{2}-\d{2}$/.test(b.today || "") ? b.today : "", now());
  res.json({ ok: true });
});
api.delete("/board", needUser, (req, res) => { db.prepare("DELETE FROM board WHERE uid = ?").run(req.user.id); res.json({ ok: true }); });

// your data, your control
api.get("/export", needUser, (req, res) => {
  const u = req.user;
  res.set("Content-Disposition", 'attachment; filename="my-ollie-data.json"');
  res.json({
    account: { email: u.email, name: u.name, created: u.created, lastSeen: u.last_seen },
    progress: db.prepare("SELECT key, data, updated FROM progress WHERE uid = ?").all(u.id).map(r => ({ key: r.key, updated: r.updated, data: JSON.parse(r.data) })),
    leaderboard: db.prepare("SELECT nick, show_pic, streak, best, wk, xp, today, upd FROM board WHERE uid = ?").get(u.id) || null
  });
});
api.delete("/me", needUser, (req, res) => { db.prepare("DELETE FROM users WHERE id = ?").run(req.user.id); db.prepare("DELETE FROM ai_usage WHERE who = ?").run(req.user.id); session.clear(res); res.json({ ok: true }); });

// admin (only emails listed in ADMIN_EMAILS)
api.get("/admin/stats", needAdmin, (req, res) => {
  const d7 = now() - 7 * 864e5, d1 = now() - 864e5;
  const c = (sql, ...a) => db.prepare(sql).get(...a).c;
  res.json({
    users: c("SELECT COUNT(*) c FROM users"), newThisWeek: c("SELECT COUNT(*) c FROM users WHERE created > ?", d7),
    active24h: c("SELECT COUNT(*) c FROM users WHERE last_seen > ?", d1), active7d: c("SELECT COUNT(*) c FROM users WHERE last_seen > ?", d7),
    onBoard: c("SELECT COUNT(*) c FROM board"), progressDocs: c("SELECT COUNT(*) c FROM progress"),
    aiRequestsToday: cfg.ai.enabled ? c("SELECT COALESCE(SUM(n),0) c FROM ai_usage WHERE day = ?", new Date().toISOString().slice(0, 10)) : null,
    dbBytes: fs.statSync(path.join(cfg.dataDir, "coach.db")).size
  });
});
api.get("/admin/board", needAdmin, (req, res) => {
  res.json({ rows: db.prepare("SELECT b.uid, b.nick, b.xp, b.wk, b.upd, u.email FROM board b JOIN users u ON u.id = b.uid ORDER BY b.upd DESC LIMIT 500").all()
    .map(r => ({ id: pubId(r.uid), nick: r.nick, xp: r.xp, wk: r.wk, upd: r.upd, email: r.email })) });
});
api.delete("/admin/board/:id", needAdmin, (req, res) => {
  const row = db.prepare("SELECT uid FROM board").all().find(r => pubId(r.uid) === req.params.id);
  if (row) db.prepare("DELETE FROM board WHERE uid = ?").run(row.uid);
  res.json({ ok: !!row });
});
// optional AI features ("Ask Ollie"), only when ANTHROPIC_API_KEY is set
api.use("/ask", ai.router({ currentUser }));

api.use((req, res) => res.status(404).json({ error: "not_found" }));
app.use("/api", api);

// ---------- pages ----------
app.get("/healthz", (req, res) => res.json({ ok: true }));
app.get("/config.json", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ googleClientId: cfg.googleClientId, devAuth: cfg.devAuth, siteName: cfg.siteName, contactEmail: cfg.contactEmail,
    analytics: cfg.analyticsSrc ? { src: cfg.analyticsSrc, domain: cfg.analyticsDomain } : null,
    ai: cfg.ai.enabled ? { requireSignIn: cfg.ai.requireSignIn } : null });
});
const pub = path.join(__dirname, "..", "public");
for (const page of ["privacy", "terms"]) {
  app.get("/" + page + ".html", (req, res) => {
    const t = fs.readFileSync(path.join(pub, page + ".html"), "utf8")
      .replace(/\{\{SITE_NAME\}\}/g, escapeHtml(cfg.siteName)).replace(/\{\{OPERATOR\}\}/g, escapeHtml(cfg.operator))
      .replace(/\{\{CONTACT\}\}/g, escapeHtml(cfg.contactEmail || "the contact address on this site"))
      .replace(/\{\{UPDATED\}\}/g, new Date().toISOString().slice(0, 10));
    res.type("html").send(t);
  });
}
app.use(express.static(pub, { extensions: ["html"], setHeaders: (res, p) => { if (/index\.html$|claude-shim\.js$|sw\.js$|manifest\.webmanifest$/.test(p)) res.set("Cache-Control", "no-cache"); } }));
app.use((req, res) => res.status(404).type("text").send("Not found"));
app.use((err, req, res, next) => {
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "too_large" });
  console.error(err); res.status(500).json({ error: "server_error" });
});

if (require.main === module) {
  app.listen(cfg.port, () => {
    console.log(`${cfg.siteName} listening on :${cfg.port} (${cfg.baseUrl})`);
    cfg.problems.forEach(p => console.warn("WARNING:", p));
  });
}
module.exports = app;
