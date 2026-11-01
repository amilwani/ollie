/* Self-hosting layer for Ollie CISA Coach.
 *
 * The app was written to run inside claude.ai, where it asks the host for three things:
 * a per-user database ("db"), the signed-in user ("user") and a file saver ("downloads").
 * This file answers those same calls from YOUR server, so the app code is unchanged:
 *   - progress sync  ->  /api/progress/*   (per Google account)
 *   - leaderboard    ->  /api/board, /api/leaderboard   (opt-in)
 *   - "Ask Ollie" and other AI features are simply absent (no Claude key is needed or used)
 * It also adds the Sign in with Google button, the account menu, the footer and the optional analytics consent bar.
 */
(function () {
  "use strict";
  window.HOSTED = true;
  const HDR = { "X-Requested-With": "ollie", "Content-Type": "application/json" };
  let me = null, cfg = {};

  async function api(method, path, body) {
    const r = await fetch("/api" + path, { method, headers: HDR, credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch (e) { /* no body */ }
    if (!r.ok) { const e = new Error((j && j.error) || "http_" + r.status); e.code = r.status === 401 ? "signed_out" : (j && j.error) || "error"; throw e; }
    return j;
  }

  const ready = (async () => {
    try { cfg = await (await fetch("/config.json", { cache: "no-store" })).json(); } catch (e) { cfg = {}; }
    try { me = (await api("GET", "/me")).user; } catch (e) { me = null; }
  })();

  // ----- the three host services the app asks for -----
  const dbService = {
    doc(path) {
      const prog = path.match(/^data\/users\/[^/]+\/(progress(?:-p\d{1,2})?)$/);
      if (prog) return {
        get: async () => { const r = await api("GET", "/progress/" + prog[1]); return { exists: !!r.exists, data: () => r.data }; },
        set: d => api("PUT", "/progress/" + prog[1], { data: d }),
        delete: async () => {}
      };
      if (/^board\/[^/]+$/.test(path)) return {
        get: async () => ({ exists: false, data: () => null }),
        set: d => api("PUT", "/board", d),
        delete: () => api("DELETE", "/board")
      };
      throw Object.assign(new Error("unsupported_path"), { code: "invalid_argument" });
    },
    collection(name) {
      if (name !== "board") throw Object.assign(new Error("unsupported_path"), { code: "invalid_argument" });
      const q = { limit() { return q; }, get: async () => { const r = await api("GET", "/leaderboard"); return { docs: r.rows.map(x => ({ id: x.id, data: () => x })) }; } };
      return q;
    }
  };
  const userService = { id: async () => (me ? me.id : null), isOwner: () => false, canEdit: () => false, can: () => null, me: async () => me };
  const downloadService = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: /\.html$/i.test(filename) ? "text/html" : /\.json$/i.test(filename) ? "application/json" : /\.csv$/i.test(filename) ? "text/csv" : "text/plain" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }
  };
  // "Ask Ollie" AI: streams from /api/ask on your server (only when ANTHROPIC_API_KEY is set there).
  function aiError(code) { const e = new Error(code); e.code = code; return e; }
  async function ask(input, opts) {
    opts = opts || {};
    const body = typeof input === "string" ? { prompt: input } : { messages: input };
    if (opts.json) body.json = true;
    let r;
    try { r = await fetch("/api/ask", { method: "POST", headers: HDR, credentials: "same-origin", body: JSON.stringify(body), signal: opts.signal }); }
    catch (e) { throw aiError(opts.signal && opts.signal.aborted ? "cancelled" : "error"); }
    if (!r.ok) { let j = null; try { j = await r.json(); } catch (e) { /* none */ } throw aiError(r.status === 429 ? "rate_limited" : r.status === 401 ? "signed_out" : (j && j.error) || "error"); }
    const rd = r.body.getReader(), dec = new TextDecoder();
    let buf = "", text = "", err = null;
    try {
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line) continue;
          let m; try { m = JSON.parse(line); } catch (e) { continue; }
          if (m.d) { text += m.d; if (opts.onText) opts.onText({ text }); }
          if (m.error) err = m.error;
        }
      }
    } catch (e) { const x = aiError(opts.signal && opts.signal.aborted ? "cancelled" : "error"); x.text = text; throw x; }
    if (err && !text) throw aiError(err);
    return { text };
  }
  const sampleService = Object.assign((input, opts) => ask(input, opts), {
    json: async (input, opts) => {
      const { text } = await ask(input, Object.assign({}, opts, { json: true }));
      const t = text.replace(/```(?:json)?/gi, "").trim();
      try { return JSON.parse(t); } catch (e) { const a = t.search(/[\[{]/), b = Math.max(t.lastIndexOf("]"), t.lastIndexOf("}")); if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1)); throw aiError("bad_json"); }
    }
  });
  const aiReady = () => !!cfg.ai && (!cfg.ai.requireSignIn || !!me);

  window.claude = {
    use: async name => {
      await ready;
      if (name === "db") return dbService;
      if (name === "user") return userService;
      if (name === "downloads") return downloadService;
      if (name === "sample") return aiReady() ? sampleService : null;
      return null;
    }
  };

  // ----- account UI -----
  const css = document.createElement("style");
  css.textContent = `
  #acctbtn{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:34px;padding:0 10px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:600 13px/1 inherit;cursor:pointer;gap:6px}
  #acctbtn img{width:24px;height:24px;border-radius:50%;object-fit:cover}
  #acctbtn:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
  #acctmenu{position:fixed;top:calc(56px + env(safe-area-inset-top,0px));right:max(12px,env(safe-area-inset-right,0px));z-index:80;width:min(320px,calc(100vw - 24px));background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 36px rgba(0,0,0,.22);padding:14px;display:flex;flex-direction:column;gap:10px}
  #acctmenu[hidden]{display:none}
  #acctmenu .who{display:flex;gap:10px;align-items:center}
  #acctmenu .who img{width:40px;height:40px;border-radius:50%}
  #acctmenu .who b{display:block}
  #acctmenu .who span{font-size:12px;color:var(--muted);word-break:break-all}
  #acctmenu button.mi{all:unset;box-sizing:border-box;cursor:pointer;padding:9px 10px;border-radius:8px;font-size:14px;color:var(--ink)}
  #acctmenu button.mi:hover,#acctmenu button.mi:focus-visible{background:var(--sunk)}
  #acctmenu button.mi.danger{color:var(--weak)}
  #acctmenu p{margin:0;font-size:13px;color:var(--ink2);line-height:1.45}
  #acctmenu .fine{font-size:12px;color:var(--muted)}
  #acctmenu input{padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)}
  #hostfoot{max-width:960px;margin:28px auto 0;padding:16px 16px calc(90px + env(safe-area-inset-bottom,0px));font-size:12px;line-height:1.5;color:var(--muted);text-align:center}
  #hostfoot a{color:inherit;text-decoration:underline}
  #anbar{position:fixed;left:12px;right:12px;bottom:calc(72px + env(safe-area-inset-bottom,0px));z-index:70;max-width:440px;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.2);padding:12px 14px;font-size:13px;display:flex;flex-direction:column;gap:8px}
  #anbar .r{display:flex;gap:8px}
  `;
  document.head.appendChild(css);

  const el = (tag, attrs, html) => { const e = document.createElement(tag); Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v)); if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = m => { try { window.toast(m); } catch (e) { /* app toast not ready */ } };
  let btn, menu, gsiLoaded = false;

  function paintButton() {
    btn.innerHTML = me ? (me.picture ? `<img alt="" referrerpolicy="no-referrer" src="${esc(me.picture)}">` : esc((me.name || me.email || "?").trim()[0].toUpperCase())) : "Sign in";
    btn.setAttribute("aria-label", me ? "Account menu for " + (me.name || me.email) : "Sign in with Google");
  }

  async function finishLogin(credential) {
    try { await api("POST", "/auth/google", { credential }); location.reload(); }
    catch (e) { menu.querySelector(".err") && (menu.querySelector(".err").textContent = e.code === "domain_not_allowed" ? "This site only accepts certain email domains." : "Sign-in failed. Please try again."); }
  }
  function loadGsi() {
    if (gsiLoaded || !cfg.googleClientId) return Promise.resolve();
    gsiLoaded = true;
    return new Promise(res => { const s = el("script", { src: "https://accounts.google.com/gsi/client", async: "", defer: "" }); s.onload = res; s.onerror = res; document.head.appendChild(s); });
  }

  function drawMenu() {
    if (me) {
      menu.innerHTML = `<div class="who">${me.picture ? `<img alt="" referrerpolicy="no-referrer" src="${esc(me.picture)}">` : ""}<div><b>${esc(me.name || "Signed in")}</b><span>${esc(me.email)}</span></div></div>
      <p class="fine">Your progress syncs to this Google account on every device.</p>
      <button class="mi" data-m="board">Leaderboard (opt-in)</button>
      ${me.admin ? `<button class="mi" data-m="admin">Admin dashboard</button>` : ""}
      <button class="mi" data-m="export">Download my data</button>
      <button class="mi" data-m="out">Sign out</button>
      <button class="mi danger" data-m="delete">Delete my account and data…</button>
      <p class="fine"><a href="/privacy.html" target="_blank" rel="noopener">Privacy</a> · <a href="/terms.html" target="_blank" rel="noopener">Terms</a></p>`;
    } else {
      menu.innerHTML = `<p><b>Sign in with Google</b></p>
      <p>Sync your progress across devices and, if you choose, join the leaderboard${cfg.ai && cfg.ai.requireSignIn ? ". Signing in also turns on <b>Ask Ollie</b>, the AI tutor" : ""}. The app works fine without an account; progress then stays in this browser.</p>
      <div id="gbtn"></div>
      ${cfg.devAuth ? `<div><input id="devemail" placeholder="dev email (test mode)" value="tester@example.com"><button class="mi" data-m="dev">Dev sign-in</button></div>` : ""}
      ${!cfg.googleClientId && !cfg.devAuth ? `<p class="fine">Sign-in is not configured on this server yet.</p>` : ""}
      <p class="err fine" role="status"></p>
      <p class="fine">We receive your name, email and photo from Google. See the <a href="/privacy.html" target="_blank" rel="noopener">privacy notice</a>.</p>`;
      loadGsi().then(() => {
        if (!window.google || !google.accounts) return;
        google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: r => finishLogin(r.credential), ux_mode: "popup", auto_select: false });
        google.accounts.id.renderButton(menu.querySelector("#gbtn"), { theme: "outline", size: "large", shape: "pill", text: "continue_with", width: 260 });
      });
    }
  }

  async function onMenu(e) {
    const m = e.target.closest("[data-m]"); if (!m) return;
    const act = m.dataset.m;
    if (act === "board") { menu.hidden = true; try { window.go("buddies"); } catch (x) { /* ignore */ } }
    else if (act === "admin") location.href = "/admin.html";
    else if (act === "export") { try { const r = await fetch("/api/export", { credentials: "same-origin" }); await downloadService.save({ filename: "my-ollie-data.json", data: await r.text() }); } catch (x) { toast("Couldn't download your data"); } }
    else if (act === "out") { try { await api("POST", "/auth/logout"); } catch (x) { /* ignore */ } location.reload(); }
    else if (act === "dev") finishLogin("dev:" + menu.querySelector("#devemail").value + ":Dev Tester");
    else if (act === "delete") {
      menu.innerHTML = `<p><b>Delete your account?</b></p><p>This permanently removes your synced progress, leaderboard entry and account record from this server. Progress saved in this browser is kept. This cannot be undone.</p>
      <button class="mi danger" data-m="delete2">Yes, delete everything on the server</button><button class="mi" data-m="cancel">Cancel</button>`;
    }
    else if (act === "delete2") { try { await api("DELETE", "/me"); } catch (x) { /* ignore */ } location.reload(); }
    else if (act === "cancel") drawMenu();
  }

  function mount() {
    const bar = document.querySelector(".topin"), search = document.getElementById("searchbtn");
    btn = el("button", { id: "acctbtn", type: "button", "aria-haspopup": "true" });
    if (bar) bar.insertBefore(btn, search || null); else document.body.appendChild(btn);
    menu = el("div", { id: "acctmenu", role: "dialog", "aria-label": "Account" }); menu.hidden = true; document.body.appendChild(menu);
    paintButton();
    btn.addEventListener("click", e => { e.stopPropagation(); menu.hidden = !menu.hidden; if (!menu.hidden) drawMenu(); });
    menu.addEventListener("click", onMenu);
    document.addEventListener("click", e => { const path = e.composedPath ? e.composedPath() : []; if (!menu.hidden && !path.includes(menu) && !path.includes(btn)) menu.hidden = true; });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !menu.hidden) { menu.hidden = true; btn.focus(); } });

    const foot = el("footer", { id: "hostfoot" }, `${esc(cfg.siteName || "Ollie CISA Coach")} is an independent study aid. It is not affiliated with, endorsed by or sponsored by ISACA. CISA® and ISACA® are registered marks of ISACA.<br><a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a>${cfg.contactEmail ? ` · <a href="mailto:${esc(cfg.contactEmail)}">Contact</a>` : ""}`);
    document.body.appendChild(foot);
    analyticsBar();
  }

  // ----- optional analytics: loaded only after an explicit "Allow" -----
  function loadAnalytics() {
    if (!cfg.analytics || document.getElementById("an-s")) return;
    const s = el("script", { id: "an-s", src: cfg.analytics.src, defer: "" });
    if (cfg.analytics.domain) s.setAttribute("data-domain", cfg.analytics.domain);
    document.head.appendChild(s);
  }
  function analyticsBar() {
    if (!cfg.analytics) return;
    let v = null; try { v = localStorage.getItem("ollie-analytics"); } catch (e) { /* storage blocked */ }
    if (v === "yes") return loadAnalytics();
    if (v === "no") return;
    const b = el("div", { id: "anbar", role: "region", "aria-label": "Analytics choice" }, `<span>Help improve this site? We would like to count visits with privacy-friendly analytics (no ads, no cross-site tracking). Entirely optional.</span><div class="r"><button class="btn sm primary" data-a="yes">Allow</button><button class="btn sm" data-a="no">No thanks</button></div>`);
    b.addEventListener("click", e => { const a = e.target.closest("[data-a]"); if (!a) return; try { localStorage.setItem("ollie-analytics", a.dataset.a); } catch (x) { /* ignore */ } b.remove(); if (a.dataset.a === "yes") loadAnalytics(); });
    document.body.appendChild(b);
  }

  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  window.addEventListener("DOMContentLoaded", () => ready.then(mount));
  if (document.readyState !== "loading") ready.then(mount);
})();
