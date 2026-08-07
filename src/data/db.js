import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { MIGRATIONS } from "./migrations.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR ?? join(__dirname, "../../data");
const DB_PATH = join(DATA_DIR, "sinebot.db");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

/**
 * Runs `fn` inside a transaction. Nesting is safe: an inner call joins the
 * transaction already in flight rather than issuing a second BEGIN, which
 * SQLite would reject.
 */
export function tx(fn) {
  if (db.isTransaction) return fn();

  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_version")
      .all()
      .map((r) => r.version),
  );
  const record = db.prepare(
    "INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)",
  );

  for (const { version, name, up } of MIGRATIONS) {
    if (applied.has(version)) continue;
    tx(() => {
      up(db);
      record.run(version, name, Date.now());
    });
    console.log(`[db] applied migration ${version}: ${name}`);
  }
}

migrate();
