/* GitHub Pages / static layer for Ollie CISA Coach.
 *
 * The app was written to run inside claude.ai, where it can ask the host for a database, the
 * signed-in user and a file saver. A static site has no server, so this file only provides the
 * file saver. Everything else falls back to the app's built-in behaviour: progress is saved in
 * this browser (localStorage), there is no sign-in, no sync and no leaderboard, and the optional
 * AI buttons stay hidden. Nothing is sent anywhere.
 */
(function () {
  "use strict";
  window.HOSTED = true;
  const downloads = {
    async save({ filename, data }) {
      const type = /\.html$/i.test(filename) ? "text/html" : /\.json$/i.test(filename) ? "application/json" : /\.csv$/i.test(filename) ? "text/csv" : "text/plain";
      const blob = data instanceof Blob ? data : new Blob([data], { type });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }
  };
  window.claude = { use: async name => (name === "downloads" ? downloads : null) };

  function footer() {
    if (document.getElementById("hostfoot")) return;
    const s = document.createElement("style");
    s.textContent = "#hostfoot{max-width:960px;margin:28px auto 0;padding:16px 16px calc(90px + env(safe-area-inset-bottom,0px));font-size:12px;line-height:1.5;color:var(--muted);text-align:center}#hostfoot a{color:inherit;text-decoration:underline}";
    document.head.appendChild(s);
    const f = document.createElement("footer"); f.id = "hostfoot";
    f.innerHTML = "Ollie CISA Coach is an independent study aid. It is not affiliated with, endorsed by or sponsored by ISACA. CISA® and ISACA® are registered marks of ISACA.<br>Your progress stays in this browser. <a href=\"privacy.html\">Privacy</a> · <a href=\"https://github.com/amilwani/ollie\" rel=\"noopener\">Source</a>";
    document.body.appendChild(f);
  }
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", footer); else footer();
})();
