// Ordered schema migrations. Each entry runs exactly once, tracked in the
// `schema_version` table, inside a transaction. Never edit or reorder a
// migration that has shipped — append a new one instead.
//
// Migration 1 is deliberately idempotent (CREATE IF NOT EXISTS throughout) so
// that a database created by the pre-ledger bootstrap adopts the ledger cleanly
// without dropping anything.

export const MIGRATIONS = [
  {
    version: 1,
    name: "baseline",
    up(db) {
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

      // `results` predates the points columns on databases built by the
      // original bootstrap; add them when absent.
      const cols = new Set(
        db
          .prepare("PRAGMA table_info(results)")
          .all()
          .map((c) => c.name),
      );
      if (!cols.has("points")) db.exec("ALTER TABLE results ADD COLUMN points INTEGER");
      if (!cols.has("details")) db.exec("ALTER TABLE results ADD COLUMN details TEXT");
    },
  },

  {
    version: 2,
    name: "user preferences become global and per-game",
    up(db) {
      // DM preferences were guild-scoped, which made a "stop" reply in a DM
      // ambiguous once the bot serves more than one server. Preferences are
      // about the person, not the server, so they move to a global table —
      // keyed by game so each game can be muted independently.
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_prefs (
          discord_user_id TEXT NOT NULL,
          game            TEXT NOT NULL,
          dm_enabled      INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY (discord_user_id, game)
        );
      `);

      // Collapse per-guild rows to one row per user. MIN() means a user who
      // opted out in any guild stays opted out — never resubscribe someone
      // who already said stop.
      db.exec(`
        INSERT INTO user_prefs (discord_user_id, game, dm_enabled)
        SELECT discord_user_id, 'connections', MIN(connections_dm)
        FROM user_settings
        GROUP BY discord_user_id
        ON CONFLICT (discord_user_id, game) DO NOTHING;
      `);

      db.exec("DROP TABLE IF EXISTS user_settings");
    },
  },

  {
    version: 3,
    name: "per-guild game configuration",
    up(db) {
      // Replaces the single WORDLE_CHANNEL_ID env var. One row per guild per
      // game, so a server can track different games in different channels.
      db.exec(`
        CREATE TABLE IF NOT EXISTS guild_config (
          guild_id   TEXT NOT NULL,
          game       TEXT NOT NULL,
          channel_id TEXT,
          enabled    INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY (guild_id, game)
        );
      `);
    },
  },

  {
    version: 4,
    name: "indices for puzzle and time-series lookups",
    up(db) {
      // The self-report path hits (guild, game, puzzle) on every recompute and
      // (guild, game, ts) on every graph render; both were full scans.
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_results_puzzle
          ON results(guild_id, game, puzzle_id);

        CREATE INDEX IF NOT EXISTS idx_results_player_puzzle
          ON results(guild_id, game, player_id, puzzle_id);

        CREATE INDEX IF NOT EXISTS idx_results_ts
          ON results(guild_id, game, ts);
      `);
    },
  },
];
