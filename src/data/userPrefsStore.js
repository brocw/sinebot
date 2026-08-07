import { db } from "./db.js";

// DM preferences are global, not guild-scoped: a DM channel has no guild, so a
// "stop" reply would otherwise be ambiguous once the bot serves more than one
// server. Preferences belong to the person, not the server.

const selectDm = db.prepare(
  "SELECT dm_enabled FROM user_prefs WHERE discord_user_id = ? AND game = ?",
);
const selectAllForUser = db.prepare(
  "SELECT game, dm_enabled FROM user_prefs WHERE discord_user_id = ?",
);
const upsertDm = db.prepare(
  `INSERT INTO user_prefs (discord_user_id, game, dm_enabled)
   VALUES (?, ?, ?)
   ON CONFLICT (discord_user_id, game) DO UPDATE SET dm_enabled = excluded.dm_enabled`,
);

/** Defaults to enabled for games the user has never touched. */
export function dmEnabled(userId, game) {
  return (selectDm.get(userId, game)?.dm_enabled ?? 1) === 1;
}

export function setDmEnabled(userId, game, enabled) {
  upsertDm.run(userId, game, enabled ? 1 : 0);
}

/** Sets the DM preference for every registered game at once. */
export function setDmEnabledAll(userId, gameIds, enabled) {
  for (const game of gameIds) setDmEnabled(userId, game, enabled);
}

export function allPrefs(userId) {
  return Object.fromEntries(
    selectAllForUser.all(userId).map((r) => [r.game, r.dm_enabled === 1]),
  );
}
