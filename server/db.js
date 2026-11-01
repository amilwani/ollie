const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const cfg = require("./config");

fs.mkdirSync(cfg.dataDir, { recursive: true });
const db = new Database(path.join(cfg.dataDir, "coach.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,            -- Google account 'sub' (stable, never the email)
  email TEXT NOT NULL,
  name TEXT,
  picture TEXT,
  created INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS progress (
  uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,              -- 'progress', 'progress-p2', ...
  data TEXT NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY (uid, key)
);
CREATE TABLE IF NOT EXISTS board (
  uid TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nick TEXT NOT NULL,
  show_pic INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best INTEGER NOT NULL DEFAULT 0,
  wk INTEGER NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  today TEXT NOT NULL DEFAULT '',
  upd INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS board_rank ON board (wk DESC, streak DESC, xp DESC);
`);
module.exports = db;
