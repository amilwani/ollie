// All settings come from environment variables (see .env.example).
const fs = require("fs");
const path = require("path");

// Tiny .env loader so you do not need an extra dependency. Real environment variables win.
try {
  const f = path.join(__dirname, "..", ".env");
  if (fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch (e) { /* ignore */ }

const list = v => String(v || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const env = process.env;

const cfg = {
  port: +env.PORT || 3000,
  prod: env.NODE_ENV === "production",
  baseUrl: (env.BASE_URL || "http://localhost:" + (+env.PORT || 3000)).replace(/\/$/, ""),
  googleClientId: env.GOOGLE_CLIENT_ID || "",
  sessionSecret: env.SESSION_SECRET || "",
  sessionDays: +env.SESSION_DAYS || 30,
  dataDir: path.resolve(env.DATA_DIR || path.join(__dirname, "..", "data")),
  adminEmails: list(env.ADMIN_EMAILS),
  allowedDomains: list(env.ALLOWED_EMAIL_DOMAINS),   // empty = any Google account
  siteName: env.SITE_NAME || "Ollie CISA Coach",
  operator: env.OPERATOR_NAME || "the site operator",
  contactEmail: env.CONTACT_EMAIL || "",
  analyticsSrc: env.ANALYTICS_SRC || "",             // e.g. https://plausible.io/js/script.js
  analyticsDomain: env.ANALYTICS_DOMAIN || "",
  trustProxy: env.TRUST_PROXY === undefined ? 1 : (env.TRUST_PROXY === "false" ? false : (isNaN(+env.TRUST_PROXY) ? env.TRUST_PROXY : +env.TRUST_PROXY)),
  // test only: accept "dev:<email>:<name>" as a credential. Refused when NODE_ENV=production.
  devAuth: env.DEV_FAKE_AUTH === "1" && env.NODE_ENV !== "production",
  // optional "Ask Ollie" AI features (see docs/AI_SETUP.md). Off unless an API key is set.
  ai: {
    apiKey: env.ANTHROPIC_API_KEY || "",
    enabled: !!env.ANTHROPIC_API_KEY,
    model: env.AI_MODEL || "claude-opus-5-5",
    effort: env.AI_EFFORT === undefined ? "low" : env.AI_EFFORT,        // blank = model default
    maxTokens: +env.AI_MAX_TOKENS || 2000,
    requireSignIn: env.AI_REQUIRE_SIGNIN !== "false",
    perMinute: +env.AI_PER_MINUTE || 10,
    perUserDaily: +env.AI_DAILY_PER_USER || 40,
    siteDaily: +env.AI_DAILY_SITE || 1000,
    fallbacks: env.AI_FALLBACKS !== "false"
  }
};

cfg.problems = [];
if (!cfg.devAuth && !cfg.googleClientId) cfg.problems.push("GOOGLE_CLIENT_ID is not set. Sign-in is disabled until you add it.");
if (!cfg.sessionSecret || cfg.sessionSecret.length < 32) {
  if (cfg.prod) { console.error("SESSION_SECRET must be set to a random string of 32+ characters in production."); process.exit(1); }
  cfg.sessionSecret = require("crypto").randomBytes(32).toString("hex");
  cfg.problems.push("SESSION_SECRET not set: using a random one for this run (everyone is signed out on restart).");
}
module.exports = cfg;
