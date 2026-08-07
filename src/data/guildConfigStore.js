import { db } from "./db.js";

// Per-guild, per-game channel routing. Replaces the single WORDLE_CHANNEL_ID
// env var so one process can serve many servers, each with its own layout.

const selectOne = db.prepare(
  "SELECT channel_id, enabled FROM guild_config WHERE guild_id = ? AND game = ?",
);
const selectForGuild = db.prepare(
  "SELECT game, channel_id, enabled FROM guild_config WHERE guild_id = ?",
);
const upsertChannel = db.prepare(
  `INSERT INTO guild_config (guild_id, game, channel_id, enabled)
   VALUES (?, ?, ?, 1)
   ON CONFLICT (guild_id, game)
   DO UPDATE SET channel_id = excluded.channel_id, enabled = 1`,
);
const upsertEnabled = db.prepare(
  `INSERT INTO guild_config (guild_id, game, channel_id, enabled)
   VALUES (?, ?, NULL, ?)
   ON CONFLICT (guild_id, game) DO UPDATE SET enabled = excluded.enabled`,
);

/**
 * The channel a game is tracked in, or null when unconfigured/disabled.
 *
 * Falls back to the legacy WORDLE_CHANNEL_ID env var when a guild has no row
 * yet, so the existing deployment keeps working untouched until it runs
 * `/config channel`.
 */
export function trackedChannel(guildId, game) {
  const row = selectOne.get(guildId, game);
  if (!row) return process.env.WORDLE_CHANNEL_ID ?? null;
  if (row.enabled !== 1) return null;
  return row.channel_id;
}

/** @returns {{ game: string, channelId: string|null, enabled: boolean }[]} */
export function guildConfig(guildId) {
  return selectForGuild.all(guildId).map((r) => ({
    game: r.game,
    channelId: r.channel_id,
    enabled: r.enabled === 1,
  }));
}

export function setChannel(guildId, game, channelId) {
  upsertChannel.run(guildId, game, channelId);
}

export function setEnabled(guildId, game, enabled) {
  upsertEnabled.run(guildId, game, enabled ? 1 : 0);
}
