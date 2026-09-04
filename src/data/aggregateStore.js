import { db, tx } from "./db.js";
import { mean, median, stdev, timeBreakdown } from "../utils/stats.js";

// Storage for "aggregate" games — a single upstream bot posts one message
// listing everyone's score for the day. Placement arrives already decided in
// that message, so unlike the self-report store nothing is ranked here.
//
// This shape also has to cope with players the upstream bot could not resolve
// to a Discord account, hence the name-key and alias machinery below.

/**
 * Everything before the role suffix, with Discord's escaping undone.
 *
 * The upstream bot has written the separator both ways over time — "Chloe G ||
 * President" in 2025, "Luc | Graphic Design Lead" since — so splitting on the
 * first pipe is the only rule that survives both. Splitting on "||" alone
 * meant a single-pipe suffix stayed part of the name, which minted a fresh
 * identity for the same person every time they edited their role: their
 * results stopped landing on their account and their streak restarted from
 * zero until an admin noticed and ran /link-user.
 *
 * Backslashes go first because Discord escapes pipes in display names, so the
 * separator can arrive as "\|" and would otherwise not be found at all.
 */
function stripRole(raw) {
  return raw.replace(/\\/g, "").split("|")[0].trim();
}

/**
 * Stable storage key for a name-type user.
 *
 * @param {string} raw  e.g. "Keanu B\\. || Vice President"
 * @returns {string}    e.g. "name:keanu b."
 */
export function nameKey(raw) {
  return `name:${stripRole(raw).toLowerCase()}`;
}

/** Strips the role suffix for display. */
export function displayFromRaw(raw, fallbackKey) {
  return raw ? stripRole(raw) : fallbackKey.replace("name:", "");
}

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
const selectUnlinked = db.prepare(
  `SELECT p.name_key, p.display_name,
          COUNT(r.result_id)        AS results,
          COALESCE(SUM(r.is_crown), 0) AS crowns,
          MIN(r.ts)                 AS first_ts,
          MAX(r.ts)                 AS last_ts,
          GROUP_CONCAT(DISTINCT r.game) AS games
   FROM players p
   LEFT JOIN results r ON r.player_id = p.player_id
   WHERE p.guild_id = ? AND p.discord_user_id IS NULL
   GROUP BY p.player_id
   ORDER BY results DESC, p.name_key`,
);
const selectAllResults = db.prepare(
  `SELECT p.discord_user_id, p.name_key, p.display_name,
          r.score, r.is_crown, r.place, r.message_id, r.ts
   FROM players p
   JOIN results r ON r.player_id = p.player_id AND r.game = ?
   WHERE p.guild_id = ?
   ORDER BY r.ts`,
);

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
      insertResult.run(
        guildId,
        game,
        resolvePlayer(guildId, user),
        null, // puzzle_id — the upstream message carries no puzzle number
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

/** Groups a guild's rows for one game by player key. */
function byPlayer(guildId, game) {
  const map = new Map();
  for (const row of selectAllResults.all(game, guildId)) {
    const key = row.discord_user_id ?? row.name_key;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        playerKey: key,
        playerType: row.discord_user_id ? "id" : "name",
        displayName: row.discord_user_id
          ? null
          : displayFromRaw(row.display_name, key),
        rows: [],
      };
      map.set(key, entry);
    }
    entry.rows.push(row);
  }
  return map;
}

/**
 * The day bucket a result falls in. Aggregate rows all carry the upstream
 * bot's post timestamp, so every player on a given day shares one of these.
 */
const dayOf = (ts) => Math.floor(ts / 86_400_000);

/** Every day this guild has a posted result for, ascending. */
function puzzleDays(players) {
  const days = new Set();
  for (const entry of players.values()) {
    for (const r of entry.rows) days.add(dayOf(r.ts));
  }
  return [...days].sort((a, b) => a - b);
}

/**
 * Consecutive puzzles solved, counting back from the group's most recent one.
 *
 * Two things this deliberately avoids. It does not count back from the
 * player's own last appearance: a run that ended in November is not a current
 * streak however long it ran, and anchoring on the player made one player who
 * had not shown up for 359 days still read "5 days".
 *
 * And it steps through the days the group actually posted rather than walking
 * the calendar one date at a time. The upstream bot is the only evidence a
 * puzzle day happened, so a date it never posted is an outage, not a miss —
 * nobody could have played it, and it should cost nobody their streak.
 *
 * A failure (null score) is still a miss: the player was there and did not
 * solve it.
 */
function currentStreak(rows, days) {
  const solved = new Set(
    rows.filter((r) => r.score !== null).map((r) => dayOf(r.ts)),
  );

  let streak = 0;
  for (let i = days.length - 1; i >= 0 && solved.has(days[i]); i--) streak++;
  return streak;
}

/**
 * Creates a store bound to one aggregate game.
 *
 * @param {string} game  registry id, e.g. "wordle"
 */
export function createAggregateStore(game) {
  /**
   * Records a single live result.
   * @returns {boolean} true if newly recorded
   */
  function record(guildId, parsedResult, messageId, ts) {
    return tx(() => applyResult(guildId, game, parsedResult, messageId, ts));
  }

  /**
   * Rebuilds a guild's results for this game from scratch. Name aliases are
   * preserved so name→ID routing survives the rebuild.
   *
   * Takes the same entry shape as the self-report store (`userId` is unused
   * here, since the upstream message names its own players) so /backfill can
   * drive either kind without branching.
   *
   * @param {{ parsed: object, messageId: string, ts: number }[]} entries oldest-first
   * @returns {number} results recorded
   */
  function rebuild(guildId, entries) {
    return tx(() => {
      deleteResultsForGame.run(guildId, game);
      deleteProcessedForGame.run(guildId, game);
      deleteOrphanPlayers.run(guildId, guildId);

      let count = 0;
      for (const { parsed, messageId, ts } of entries) {
        if (applyResult(guildId, game, parsed, messageId, ts)) count++;
      }
      return count;
    });
  }

  /** Crown leaderboard, most crowns first. */
  function getLeaderboard(guildId) {
    const out = [];
    for (const entry of byPlayer(guildId, game).values()) {
      const crowns = entry.rows.filter((r) => r.is_crown === 1).length;
      out.push({
        playerKey: entry.playerKey,
        playerType: entry.playerType,
        displayName: entry.displayName,
        uid: entry.playerType === "id" ? entry.playerKey : null,
        crowns,
        silver: entry.rows.filter((r) => r.place === 2).length,
        bronze: entry.rows.filter((r) => r.place === 3).length,
        games: entry.rows.length,
        wins: entry.rows.filter((r) => r.score !== null).length,
      });
    }
    out.sort((a, b) => b.crowns - a.crowns);
    return out;
  }

  /** Per-player stats for the /stats embed, or null when there is no data. */
  function getStats(guildId, userId) {
    const players = byPlayer(guildId, game);
    const entry = players.get(userId);
    if (!entry || entry.rows.length === 0) return null;

    const { rows } = entry;
    const crowns = rows.filter((r) => r.is_crown === 1).length;
    const solvedScores = rows.filter((r) => r.score !== null).map((r) => r.score);

    // Rank among players who have at least one crown, so "#3 of 12" counts
    // contenders rather than everyone who ever played.
    const crownCounts = [...players.values()]
      .map((e) => e.rows.filter((r) => r.is_crown === 1).length)
      .filter((n) => n > 0)
      .sort((a, b) => b - a);

    const placeCounts = {};
    for (const r of rows) {
      if (r.place != null) placeCounts[r.place] = (placeCounts[r.place] ?? 0) + 1;
    }

    // Aggregate games carry no points, so timeBreakdown's meanPoints comes back
    // null for every bucket and the games rank their days on meanScore instead.
    const { byWeekday, byMonth } = timeBreakdown(rows);

    return {
      crowns,
      rank: crownCounts.filter((n) => n > crowns).length + 1,
      contenders: crownCounts.length,
      games: rows.length,
      wins: solvedScores.length,
      failures: rows.length - solvedScores.length,
      avgScore: mean(solvedScores) ?? 0,
      medianScore: median(solvedScores),
      stdevScore: stdev(solvedScores),
      currentStreak: currentStreak(rows, puzzleDays(players)),
      placeCounts,
      byWeekday,
      byMonth,
    };
  }

  /** Flat time series for charting. Aggregate games carry no points. */
  function getSeries(guildId) {
    const out = [];
    for (const entry of byPlayer(guildId, game).values()) {
      for (const r of entry.rows) {
        out.push({
          playerKey: entry.playerKey,
          playerType: entry.playerType,
          displayName: entry.displayName,
          ts: r.ts,
          puzzleId: null,
          score: r.score,
          isCrown: r.is_crown === 1,
          place: r.place,
          points: 0,
        });
      }
    }
    return out.sort((a, b) => a.ts - b.ts);
  }

  return { record, rebuild, getLeaderboard, getStats, getSeries };
}

/**
 * Every player in a guild the upstream bot never resolved to a Discord
 * account, busiest first.
 *
 * These are the people whose results are stranded: they hold their own crowns
 * and their own streak instead of contributing to somebody's account, and
 * nothing surfaces them until someone reads a leaderboard and notices a name
 * where a mention should be. Like aliases, this is not game-scoped — a player
 * row belongs to a person, not a game — so the games they appear in come back
 * as a field rather than a filter.
 *
 * @returns {{ nameKey: string, displayName: string, results: number,
 *             crowns: number, firstTs: number|null, lastTs: number|null,
 *             games: string[] }[]}
 */
export function listUnlinked(guildId) {
  return selectUnlinked.all(guildId).map((r) => ({
    nameKey: r.name_key,
    displayName: displayFromRaw(r.display_name, r.name_key),
    results: r.results,
    crowns: r.crowns,
    firstTs: r.first_ts,
    lastTs: r.last_ts,
    games: r.games ? r.games.split(",") : [],
  }));
}

/**
 * Creates a permanent alias from a name key to a Discord user ID, then merges
 * any results already recorded under the name player into the ID player.
 *
 * Aliases are not game-scoped — a person is the same person across games — so
 * this lives outside the per-game store.
 *
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
