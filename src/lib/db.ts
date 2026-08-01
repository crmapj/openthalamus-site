import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// SQLite on a mounted volume. This is a waitlist, not a workload: a single file
// that survives redeploys and can be copied out with `cp` is worth more here
// than a Postgres container to babysit. WAL so a read never blocks a write.
const DB_PATH = process.env.WAITLIST_DB_PATH ?? "/data/waitlist.db";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      email       TEXT NOT NULL,
      email_norm  TEXT NOT NULL UNIQUE,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      ip_hash     TEXT,
      user_agent  TEXT,
      source      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at);

    CREATE TABLE IF NOT EXISTS rate_limit (
      ip_hash   TEXT PRIMARY KEY,
      hits      INTEGER NOT NULL DEFAULT 1,
      window_at INTEGER NOT NULL
    );
  `);

  return db;
}

/**
 * Normalise for duplicate detection: lowercase, and collapse Gmail's dots and
 * +tags so the same human cannot trivially fill the list with variants.
 */
export function normaliseEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1) return email;
  let local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
  }
  return `${local}@${domain}`;
}

/** Fixed-window limiter. Coarse on purpose — it only needs to stop floods. */
export function rateLimited(ipHash: string, max = 5, windowSec = 3600): boolean {
  const now = Math.floor(Date.now() / 1000);
  const d = getDb();
  const row = d
    .prepare("SELECT hits, window_at FROM rate_limit WHERE ip_hash = ?")
    .get(ipHash) as { hits: number; window_at: number } | undefined;

  if (!row || now - row.window_at >= windowSec) {
    d.prepare(
      "INSERT INTO rate_limit (ip_hash, hits, window_at) VALUES (?, 1, ?) " +
        "ON CONFLICT(ip_hash) DO UPDATE SET hits = 1, window_at = excluded.window_at",
    ).run(ipHash, now);
    return false;
  }

  if (row.hits >= max) return true;
  d.prepare("UPDATE rate_limit SET hits = hits + 1 WHERE ip_hash = ?").run(ipHash);
  return false;
}
