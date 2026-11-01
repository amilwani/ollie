// Vercel entry point: the whole Express API runs as one serverless function.
// vercel.json sends /api/*, /config.json, /healthz, /privacy.html and /terms.html here;
// everything else (the app itself) is served as static files from Vercel's CDN.
const app = require("../server/index.js");
require("../server/config").problems.forEach(p => console.warn("WARNING:", p));   // shows in Vercel logs

module.exports = (req, res) => {
  // Vercel normally passes the original URL through a rewrite. If it ever arrives as the rewrite
  // target instead ("/api?path=me"), rebuild the original "/api/me" so Express routes it.
  const m = /^\/api\/?\?(.*)$/.exec(req.url || "");
  if (m) {
    const q = new URLSearchParams(m[1]), p = q.get("path");
    if (p) { q.delete("path"); req.url = "/api/" + p + (q.toString() ? "?" + q : ""); }
  }
  return app(req, res);
};
