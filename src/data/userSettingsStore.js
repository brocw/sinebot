import { db } from "./db.js";

const selectDm = db.prepare(
  "SELECT connections_dm FROM user_settings WHERE guild_id = ? AND discord_user_id = ?",
);
const upsertDm = db.prepare(
  `INSERT INTO user_settings (guild_id, discord_user_id, connections_dm)
   VALUES (?, ?, ?)
   ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET connections_dm = excluded.connections_dm`,
);

export function getConnectionsDm(guildId, userId) {
  return (selectDm.get(guildId, userId)?.connections_dm ?? 1) === 1;
}

export function setConnectionsDm(guildId, userId, enabled) {
  upsertDm.run(guildId, userId, enabled ? 1 : 0);
}
