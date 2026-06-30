import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");
const DB_PATH = join(DATA_DIR, "sinebot.db");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// Schema bootstrap. All statements are idempotent so this runs safely on every
// startup. Every table is guild-scoped; result-bearing tables also carry a
// `game` column so additional games (e.g. Connections) drop in without schema
// changes.
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    player_id       INTEGER PRIMARY KEY,
    guild_id        TEXT NOT NULL,
    discord_user_id TEXT,
    name_key        TEXT,
    display_name    TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_players_uid
    ON players(guild_id, discord_user_id)
    WHERE discord_user_id IS NOT NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_players_name
    ON players(guild_id, name_key)
    WHERE name_key IS NOT NULL;

  CREATE TABLE IF NOT EXISTS name_aliases (
    guild_id        TEXT NOT NULL,
    name_key        TEXT NOT NULL,
    discord_user_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, name_key)
  );

  CREATE TABLE IF NOT EXISTS results (
    result_id  INTEGER PRIMARY KEY,
    guild_id   TEXT NOT NULL,
    game       TEXT NOT NULL,
    player_id  INTEGER NOT NULL REFERENCES players(player_id),
    puzzle_id  TEXT,
    score      INTEGER,
    is_crown   INTEGER NOT NULL DEFAULT 0,
    place      INTEGER,
    message_id TEXT NOT NULL,
    ts         INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_results_lookup
    ON results(guild_id, game, player_id);

  CREATE TABLE IF NOT EXISTS processed_messages (
    guild_id   TEXT NOT NULL,
    game       TEXT NOT NULL,
    message_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, game, message_id)
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    guild_id        TEXT NOT NULL,
    discord_user_id TEXT NOT NULL,
    connections_dm  INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (guild_id, discord_user_id)
  );
`);

// `results` predates the Connections points columns, so add them in place when
// missing (idempotent — guarded by the live column list).
const resultColumns = new Set(
  db.prepare("PRAGMA table_info(results)").all().map((c) => c.name),
);
if (!resultColumns.has("points")) {
  db.exec("ALTER TABLE results ADD COLUMN points INTEGER");
}
if (!resultColumns.has("details")) {
  db.exec("ALTER TABLE results ADD COLUMN details TEXT");
}
