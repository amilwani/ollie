// Stateless signed session cookie (HMAC-SHA256). No extra dependency.
const crypto = require("crypto");
const cfg = require("./config");
const NAME = "ollie_session";

const b64 = b => Buffer.from(b).toString("base64url");
const sign = p => crypto.createHmac("sha256", cfg.sessionSecret).update(p).digest("base64url");

function make(uid) {
  const p = b64(JSON.stringify({ u: uid, e: Date.now() + cfg.sessionDays * 864e5 }));
  return p + "." + sign(p);
}
function read(req) {
  const raw = (req.headers.cookie || "").split(/;\s*/).find(c => c.startsWith(NAME + "="));
  if (!raw) return null;
  const [p, s] = decodeURIComponent(raw.slice(NAME.length + 1)).split(".");
  if (!p || !s) return null;
  const good = sign(p);
  if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
  try { const o = JSON.parse(Buffer.from(p, "base64url").toString()); return o.e > Date.now() ? o.u : null; } catch (e) { return null; }
}
const attrs = () => `Path=/; HttpOnly; SameSite=Lax${cfg.baseUrl.startsWith("https") ? "; Secure" : ""}`;
function set(res, uid) { res.append("Set-Cookie", `${NAME}=${encodeURIComponent(make(uid))}; Max-Age=${cfg.sessionDays * 86400}; ${attrs()}`); }
function clear(res) { res.append("Set-Cookie", `${NAME}=; Max-Age=0; ${attrs()}`); }
module.exports = { set, clear, read };
