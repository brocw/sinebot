import { db } from "./db.js";

/**
 * Stable storage key for a name-type user.
 * Exported so the link-user command can resolve the same key without
 * duplicating normalisation logic.
 *
 * @param {string} raw  e.g. "Keanu B\\. || Vice President"
 * @returns {string}    e.g. "name:keanu b."
 */
export function nameKey(raw) {
  const namePart = raw.split("||")[0].trim().replace(/\\/g, "");
  return `name:${namePart.toLowerCase()}`;
}

// --- Prepared statements -----------------------------------------------------

const selectPlayerByUid = db.prepare(
  "SELECT player_id FROM players WHERE guild_id = ? AND discord_user_id = ?",
);
const selectPlayerByName = db.prepare(
  "SELECT player_id FROM players WHERE guild_id = ? AND name_key = ?",
);
const insertIdPlayer = db.prepare(
  "INSERT INTO players (guild_id, discord_user_id) VALUES (?, ?)",
);
const insertNamePlayer = db.prepare(
  "INSERT INTO players (guild_id, name_key, display_name) VALUES (?, ?, ?)",
);
const updateDisplayName = db.prepare(
  "UPDATE players SET display_name = ? WHERE player_id = ?",
);
const selectAlias = db.prepare(
  "SELECT discord_user_id FROM name_aliases WHERE guild_id = ? AND name_key = ?",
);
const upsertAlias = db.prepare(
  `INSERT INTO name_aliases (guild_id, name_key, discord_user_id)
   VALUES (?, ?, ?)
   ON CONFLICT(guild_id, name_key) DO UPDATE SET discord_user_id = excluded.discord_user_id`,
);
const insertResult = db.prepare(
  `INSERT INTO results
     (guild_id, game, player_id, puzzle_id, score, is_crown, place, message_id, ts)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const isProcessed = db.prepare(
  "SELECT 1 FROM processed_messages WHERE guild_id = ? AND game = ? AND message_id = ?",
);
const markProcessed = db.prepare(
  "INSERT OR IGNORE INTO processed_messages (guild_id, game, message_id) VALUES (?, ?, ?)",
);
const deleteResultsForGame = db.prepare(
  "DELETE FROM results WHERE guild_id = ? AND game = ?",
);
const deleteProcessedForGame = db.prepare(
  "DELETE FROM processed_messages WHERE guild_id = ? AND game = ?",
);
const deleteOrphanPlayers = db.prepare(
  `DELETE FROM players
   WHERE guild_id = ?
     AND player_id NOT IN (SELECT DISTINCT player_id FROM results WHERE guild_id = ?)`,
);
const countCrownsForPlayer = db.prepare(
  "SELECT COUNT(*) AS n FROM results WHERE player_id = ? AND is_crown = 1",
);
const repointResults = db.prepare(
  "UPDATE results SET player_id = ? WHERE player_id = ?",
);
const deletePlayer = db.prepare("DELETE FROM players WHERE player_id = ?");
const selectCrowns = db.prepare(
  `SELECT p.discord_user_id, p.name_key, p.display_name,
          r.score, r.is_crown, r.place, r.message_id, r.ts
   FROM players p
   JOIN results r ON r.player_id = p.player_id AND r.game = ?
   WHERE p.guild_id = ?
   ORDER BY r.ts`,
);

// --- Internal helpers --------------------------------------------------------

function tx(fn) {
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

function getOrCreateIdPlayer(guildId, discordUserId) {
  const row = selectPlayerByUid.get(guildId, discordUserId);
  if (row) return row.player_id;
  return insertIdPlayer.run(guildId, discordUserId).lastInsertRowid;
}

function getOrCreateNamePlayer(guildId, nk, raw) {
  const row = selectPlayerByName.get(guildId, nk);
  if (row) {
    updateDisplayName.run(raw, row.player_id);
    return row.player_id;
  }
  return insertNamePlayer.run(guildId, nk, raw).lastInsertRowid;
}

/**
 * Resolves the player row for a parsed user, routing name-type users through
 * the alias table so they land on the correct Discord ID player.
 */
function resolvePlayer(guildId, user) {
  if (user.type === "id") return getOrCreateIdPlayer(guildId, user.id);

  const nk = nameKey(user.raw);
  const alias = selectAlias.get(guildId, nk);
  if (alias) return getOrCreateIdPlayer(guildId, alias.discord_user_id);

  return getOrCreateNamePlayer(guildId, nk, user.raw);
}

function applyResult(guildId, game, { scores }, messageId, ts) {
  if (isProcessed.get(guildId, game, messageId)) return false;

  for (const [i, { score, isCrown, users }] of scores.entries()) {
    for (const user of users) {
      const playerId = resolvePlayer(guildId, user);
      insertResult.run(
        guildId,
        game,
        playerId,
        null, // puzzle_id — unused for Wordle
        score,
        isCrown ? 1 : 0,
        i + 1,
        messageId,
        ts,
      );
    }
  }

  markProcessed.run(guildId, game, messageId);
  return true;
}

// --- Public API --------------------------------------------------------------

/**
 * Records a single live result.
 *
 * @param {string} guildId
 * @param {string} game
 * @param {{ scores: { score: number|null, isCrown: boolean, users: any[] }[] }} parsedResult
 * @param {string} messageId
 * @param {number} ts
 * @returns {boolean} true if newly recorded
 */
export function recordResult(guildId, game, parsedResult, messageId, ts) {
  return tx(() => applyResult(guildId, game, parsedResult, messageId, ts));
}

/**
 * Rebuilds a guild's results for one game from scratch using the provided
 * results. Name aliases are preserved so name→ID routing survives the rebuild.
 *
 * @param {string} guildId
 * @param {string} game
 * @param {{ result: object, messageId: string, ts: number }[]} pairs
 * @returns {number} number of results recorded
 */
export function rebuildFromResults(guildId, game, pairs) {
  return tx(() => {
    deleteResultsForGame.run(guildId, game);
    deleteProcessedForGame.run(guildId, game);
    deleteOrphanPlayers.run(guildId, guildId);

    let count = 0;
    for (const { result, messageId, ts } of pairs) {
      if (applyResult(guildId, game, result, messageId, ts)) count++;
    }
    return count;
  });
}

/**
 * Creates a permanent alias from a name key to a Discord user ID, then merges
 * any results already recorded under the name player into the ID player.
 *
 * @param {string} guildId
 * @param {string} raw            Raw display name as seen in Wordle results
 * @param {string} discordUserId
 * @returns {{ nk: string, mergedCrowns: number }}
 */
export function linkAlias(guildId, raw, discordUserId) {
  return tx(() => {
    const nk = nameKey(raw);
    upsertAlias.run(guildId, nk, discordUserId);

    const namePlayer = selectPlayerByName.get(guildId, nk);
    let mergedCrowns = 0;
    if (namePlayer) {
      mergedCrowns = countCrownsForPlayer.get(namePlayer.player_id).n;
      const idPlayerId = getOrCreateIdPlayer(guildId, discordUserId);
      repointResults.run(idPlayerId, namePlayer.player_id);
      deletePlayer.run(namePlayer.player_id);
    }

    return { nk, mergedCrowns };
  });
}

/**
 * Returns a guild's players for one game, keyed by Discord user ID (resolved
 * players) or name key (unresolved name players), in the shape the stats,
 * crowns, and graph commands consume.
 *
 * @param {string} guildId
 * @param {string} game
 * @returns {Record<string, { type: "id"|"name", scores: { score: number|null, isCrown: boolean, place: number, messageId: string, ts: number }[], displayName?: string }>}
 */
export function getCrowns(guildId, game) {
  const users = {};
  for (const row of selectCrowns.all(game, guildId)) {
    const key = row.discord_user_id ?? row.name_key;
    if (!users[key]) {
      users[key] = row.discord_user_id
        ? { type: "id", scores: [] }
        : { type: "name", scores: [], displayName: row.display_name };
    }
    users[key].scores.push({
      score: row.score,
      isCrown: row.is_crown === 1,
      place: row.place,
      messageId: row.message_id,
      ts: row.ts,
    });
  }
  return users;
}
