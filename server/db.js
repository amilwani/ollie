// Database: SQLite through libSQL, so the same code runs on a self-hosted server (a local file)
// and on Vercel or other serverless hosts (a hosted Turso database, since their disks are not kept).
//   - TURSO_DATABASE_URL set (libsql://...)  -> hosted database, with TURSO_AUTH_TOKEN
//   - otherwise                               -> file DATA_DIR/coach.db
const fs = require("fs");
const path = require("path");
const { createClient } = require("@libsql/client");
const cfg = require("./config");

let url = cfg.db.url, local = !url;
if (local) {
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  url = "file:" + path.join(cfg.dataDir, "coach.db");
}
const client = createClient({ url, authToken: cfg.db.authToken || undefined });

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,            -- Google account 'sub' (stable, never the email)
    email TEXT NOT NULL,
    name TEXT,
    picture TEXT,
    created INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS progress (
    uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,              -- 'progress', 'progress-p2', ...
    data TEXT NOT NULL,
    updated INTEGER NOT NULL,
    PRIMARY KEY (uid, key)
  )`,
  `CREATE TABLE IF NOT EXISTS board (
    uid TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    nick TEXT NOT NULL,
    show_pic INTEGER NOT NULL DEFAULT 0,
    streak INTEGER NOT NULL DEFAULT 0,
    best INTEGER NOT NULL DEFAULT 0,
    wk INTEGER NOT NULL DEFAULT 0,
    xp INTEGER NOT NULL DEFAULT 0,
    today TEXT NOT NULL DEFAULT '',
    upd INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS board_rank ON board (wk DESC, streak DESC, xp DESC)`,
  `CREATE TABLE IF NOT EXISTS ai_usage (
    day TEXT NOT NULL,             -- YYYY-MM-DD (UTC)
    who TEXT NOT NULL,             -- user id, or 'ip:<hash>' when sign-in is not required
    n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, who)
  )`
];

// Created once per process (each serverless instance runs it on its first request; it is idempotent).
let ready = null;
function init() {
  if (!ready) {
    ready = (async () => {
      if (local) await client.execute("PRAGMA journal_mode = WAL");
      await client.batch(SCHEMA, "write");
    })().catch(e => { ready = null; throw e; });
  }
  return ready;
}

// libSQL rows are array-like; turn them into plain objects so callers can use r.column.
const plain = (rs) => rs.rows.map(r => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));
// Rows are removed explicitly (see DELETE /api/me) rather than relying on ON DELETE CASCADE,
// because foreign-key enforcement is a per-connection switch that hosted databases may not keep on.
async function exec(sql, args) { await init(); return client.execute({ sql, args }); }

module.exports = {
  init,
  local,
  all: async (sql, ...args) => plain(await exec(sql, args)),
  get: async (sql, ...args) => plain(await exec(sql, args))[0],
  run: async (sql, ...args) => { const r = await exec(sql, args); return { changes: r.rowsAffected }; },
  // statements that must run together (all or nothing)
  tx: async (stmts) => { await init(); return client.batch(stmts.map(([sql, ...args]) => ({ sql, args })), "write"); },
  file: local ? path.join(cfg.dataDir, "coach.db") : null,
  client
};
