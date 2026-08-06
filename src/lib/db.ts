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

  migrate(db);
  return db;
}

/**
 * Additive column migrations.
 *
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, and the table already exists in
 * production with rows in it, so each column is added only when absent. Adding
 * a nullable column is an O(1) metadata change — safe to run on every boot.
 */
function migrate(d: Database.Database): void {
  const existing = new Set(
    (d.prepare("PRAGMA table_info(waitlist)").all() as Array<{ name: string }>).map((c) => c.name),
  );

  // Attribution. AI answer engines are the channel that matters for this
  // product, and most of them send no UTM at all — so `referrer` is the real
  // signal and `channel` is the derived, queryable version of it.
  const columns: Record<string, string> = {
    referrer: "TEXT",
    utm: "TEXT",
    landing: "TEXT",
    channel: "TEXT",
  };

  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) d.exec(`ALTER TABLE waitlist ADD COLUMN ${name} ${type}`);
  }

  d.exec("CREATE INDEX IF NOT EXISTS idx_waitlist_channel ON waitlist(channel)");
}

/**
 * Bucket a referrer into a channel worth counting.
 *
 * The list leads with answer engines on purpose: "did an LLM send this person"
 * is the question this site most needs answered, and roughly a third to two
 * thirds of AI referrals arrive with no referrer header at all — so anything
 * that *does* carry one is worth classifying precisely rather than lumping
 * into "other".
 */
export function classifyChannel(referrer: string, utm: string): string {
  const hay = `${referrer} ${utm}`.toLowerCase();
  if (!referrer && !utm) return "direct";

  const rules: Array<[string, RegExp]> = [
    ["chatgpt", /chatgpt\.com|chat\.openai\.com|openai\.com/],
    ["claude", /claude\.ai|anthropic\.com/],
    ["perplexity", /perplexity\.ai/],
    ["gemini", /gemini\.google\.com|bard\.google\.com/],
    ["copilot", /copilot\.microsoft\.com/],
    ["ai-other", /you\.com|mistral\.ai|kagi\.com|phind\.com|duckduckgo\.com\/aichat/],
    ["hn", /news\.ycombinator\.com/],
    ["reddit", /reddit\.com/],
    ["github", /github\.com/],
    ["x", /(^|\/\/|\.)(x\.com|twitter\.com|t\.co)/],
    ["linkedin", /linkedin\.com|lnkd\.in/],
    ["search", /google\.|bing\.com|duckduckgo\.com|ecosia\.org|brave\.com/],
  ];

  for (const [name, re] of rules) if (re.test(hay)) return name;
  return referrer ? "referral" : "campaign";
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
