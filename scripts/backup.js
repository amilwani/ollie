#!/usr/bin/env node
/* Safe online backup of the SQLite database (works while the server is running).
 *   npm run backup                 -> data/backups/coach-YYYY-MM-DD-HHMM.db   (keeps the newest 14)
 *   BACKUP_KEEP=30 npm run backup  -> keep 30
 * Schedule it (cron example in README), then copy data/backups/ off the machine (another disk, object storage, rsync).
 */
const fs = require("fs");
const path = require("path");
const cfg = require("../server/config");
const db = require("../server/db");

if (!db.local) {
  console.log("This site uses a hosted Turso database, which keeps its own backups (point-in-time restore in the Turso dashboard).");
  console.log("To take a copy anyway:  turso db shell <db-name> .dump > ollie-backup.sql");
  process.exit(0);
}
const dir = path.join(cfg.dataDir, "backups");
fs.mkdirSync(dir, { recursive: true });
const d = new Date(), p = n => String(n).padStart(2, "0");
const name = `coach-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.db`;
const out = path.join(dir, name);
// VACUUM INTO writes a consistent copy while the server keeps running.
db.init().then(() => db.client.execute({ sql: "VACUUM INTO ?", args: [out] })).then(() => {
  db.client.close();
  const keep = +process.env.BACKUP_KEEP || 14;
  const files = fs.readdirSync(dir).filter(f => /^coach-.*\.db$/.test(f)).sort();
  files.slice(0, Math.max(0, files.length - keep)).forEach(f => fs.unlinkSync(path.join(dir, f)));
  console.log("Backup written:", out, `(keeping ${Math.min(files.length, keep)})`);
}).catch(e => { console.error("Backup failed:", e.message); process.exit(1); });
