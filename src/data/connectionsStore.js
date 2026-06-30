import { db } from "./db.js";
import { basePoints, dailyScore } from "../utils/connectionsScore.js";

const GAME = "connections";

// Connections players are always real Discord users (self-shared results), so
// there is no name-key / alias machinery here — only id players.

const selectPlayerByUid = db.prepare(
  "SELECT player_id FROM players WHERE guild_id = ? AND discord_user_id = ?",
);
const insertIdPlayer = db.prepare(
  "INSERT INTO players (guild_id, discord_user_id) VALUES (?, ?)",
);
const insertResult = db.prepare(
  `INSERT INTO results
     (guild_id, game, player_id, puzzle_id, score, points, details, is_crown, place, message_id, ts)
   VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
);
const isProcessed = db.prepare(
  "SELECT 1 FROM processed_messages WHERE guild_id = ? AND game = ? AND message_id = ?",
);
const markProcessed = db.prepare(
  "INSERT OR IGNORE INTO processed_messages (guild_id, game, message_id) VALUES (?, ?, ?)",
);
const selectPlayerPuzzle = db.prepare(
  `SELECT 1 FROM results
   WHERE guild_id = ? AND game = ? AND puzzle_id = ? AND player_id = ?`,
);
const selectPuzzleResults = db.prepare(
  "SELECT result_id, player_id, score, points FROM results WHERE guild_id = ? AND game = ? AND puzzle_id = ?",
);
const selectSolvedForPlayer = db.prepare(
  "SELECT puzzle_id FROM results WHERE guild_id = ? AND game = ? AND player_id = ? AND score IS NOT NULL",
);
const updateRank = db.prepare(
  "UPDATE results SET is_crown = ?, place = ? WHERE result_id = ?",
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
const selectPuzzleCrownRows = db.prepare(
  `SELECT p.discord_user_id AS uid, r.player_id, r.points
   FROM results r
   JOIN players p ON p.player_id = r.player_id
   WHERE r.guild_id = ? AND r.game = ? AND r.puzzle_id = ? AND r.is_crown = 1
   ORDER BY r.ts`,
);
const countPuzzlePlayers = db.prepare(
  "SELECT COUNT(*) AS n FROM results WHERE guild_id = ? AND game = ? AND puzzle_id = ?",
);
const selectAllConnections = db.prepare(
  `SELECT p.discord_user_id AS uid, r.player_id, r.puzzle_id, r.score, r.points, r.is_crown
   FROM results r
   JOIN players p ON p.player_id = r.player_id
   WHERE r.guild_id = ? AND r.game = ?`,
);
const selectPlayerConnections = db.prepare(
  `SELECT r.puzzle_id, r.score, r.points, r.is_crown, r.details
   FROM results r
   JOIN players p ON p.player_id = r.player_id
   WHERE r.guild_id = ? AND r.game = ? AND p.discord_user_id = ?`,
);

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

// `score` keeps the mistakes/null convention (null = loss) for the avg-mistakes
// stat; `points` and `details` carry the scoring breakdown.
const scoreFor = (parsed) => (parsed.solved ? parsed.mistakes : null);
const detailsFor = (parsed) =>
  JSON.stringify({
    slipMistakes: parsed.slipMistakes,
    purpleFirst: parsed.purpleFirst,
    reverseRainbow: parsed.reverseRainbow,
    solveOrder: parsed.solveOrder,
  });

function solvedSetFor(guildId, playerId) {
  return new Set(
    selectSolvedForPlayer
      .all(guildId, GAME, playerId)
      .map((r) => Number(r.puzzle_id)),
  );
}

// Consecutive solved days ending at `puzzleNum`. Puzzle numbers are one-per-day,
// so consecutive numbers are consecutive days. 0 if `puzzleNum` itself is a loss.
function streakAsOf(solvedSet, puzzleNum) {
  let k = 0;
  let p = puzzleNum;
  while (solvedSet.has(p)) {
    k++;
    p--;
  }
  return k;
}

/**
 * Recomputes crown + place for every result of one puzzle, ranking by full daily
 * score (base points + that player's solved streak as of this puzzle). Unlike
 * Wordle, Connections placement is derived by comparing players and shifts as
 * more people post. Ties share a place; the crown goes to every solver tied for
 * the top score. If nobody solved the puzzle, no crown is awarded.
 */
function recomputePuzzle(guildId, puzzleId) {
  const puzzleNum = Number(puzzleId);
  const rows = selectPuzzleResults.all(guildId, GAME, puzzleId);

  const scored = rows.map((r) => {
    const solved = r.score !== null;
    const ds = solved
      ? dailyScore(r.points, streakAsOf(solvedSetFor(guildId, r.player_id), puzzleNum))
      : 0;
    return { result_id: r.result_id, ds };
  });

  const solvedScores = scored.filter((s) => s.ds > 0).map((s) => s.ds);
  const best = solvedScores.length ? Math.max(...solvedScores) : 0;

  const ranked = [...scored].sort((a, b) => b.ds - a.ds);
  let place = 0;
  let prev = null;
  ranked.forEach((r, i) => {
    if (r.ds !== prev) {
      place = i + 1;
      prev = r.ds;
    }
    const isCrown = best > 0 && r.ds === best ? 1 : 0;
    updateRank.run(isCrown, place, r.result_id);
  });
}

/**
 * Records a single live Connections result and recomputes that puzzle's
 * standings. Ignores duplicate message IDs and re-shares of a puzzle the player
 * already logged.
 *
 * @returns {{ base: number, streak: number, total: number } | null} scoring
 *   details if newly recorded, null otherwise
 */
export function recordConnectionsResult(
  guildId,
  parsed,
  discordUserId,
  messageId,
  ts,
) {
  return tx(() => {
    if (isProcessed.get(guildId, GAME, messageId)) return null;

    const puzzleId = String(parsed.puzzle);
    const playerId = getOrCreateIdPlayer(guildId, discordUserId);

    // A player only counts once per puzzle (guard against re-shares).
    if (selectPlayerPuzzle.get(guildId, GAME, puzzleId, playerId)) {
      markProcessed.run(guildId, GAME, messageId);
      return null;
    }

    const base = basePoints(parsed);
    insertResult.run(
      guildId,
      GAME,
      playerId,
      puzzleId,
      scoreFor(parsed),
      base,
      detailsFor(parsed),
      messageId,
      ts,
    );
    markProcessed.run(guildId, GAME, messageId);
    recomputePuzzle(guildId, puzzleId);

    const streak = parsed.solved
      ? streakAsOf(solvedSetFor(guildId, playerId), parsed.puzzle)
      : 0;
    return { base, streak, total: dailyScore(base, streak) };
  });
}

/**
 * Rebuilds a guild's Connections history from scanned messages, then recomputes
 * every affected puzzle once.
 *
 * @param {string} guildId
 * @param {{ parsed: object, userId: string, messageId: string, ts: number }[]} entries oldest-first
 * @returns {number} number of results recorded
 */
export function rebuildConnections(guildId, entries) {
  return tx(() => {
    deleteResultsForGame.run(guildId, GAME);
    deleteProcessedForGame.run(guildId, GAME);
    deleteOrphanPlayers.run(guildId, guildId);

    const seen = new Set();
    const puzzles = new Set();
    let count = 0;

    for (const { parsed, userId, messageId, ts } of entries) {
      const puzzleId = String(parsed.puzzle);
      const playerId = getOrCreateIdPlayer(guildId, userId);
      const dedupKey = `${playerId}|${puzzleId}`;
      if (seen.has(dedupKey)) {
        markProcessed.run(guildId, GAME, messageId);
        continue;
      }
      seen.add(dedupKey);

      insertResult.run(
        guildId,
        GAME,
        playerId,
        puzzleId,
        scoreFor(parsed),
        basePoints(parsed),
        detailsFor(parsed),
        messageId,
        ts,
      );
      markProcessed.run(guildId, GAME, messageId);
      puzzles.add(puzzleId);
      count++;
    }

    for (const puzzleId of puzzles) recomputePuzzle(guildId, puzzleId);
    return count;
  });
}

/**
 * Crown winner(s) and player count for one puzzle, for the daily summary. Each
 * winner's `score` is their full daily score (base + streak).
 *
 * @returns {{ crowns: { uid: string, score: number }[], players: number }}
 */
export function getPuzzleCrowns(guildId, puzzleId) {
  const puzzleNum = Number(puzzleId);
  const crowns = selectPuzzleCrownRows
    .all(guildId, GAME, String(puzzleId))
    .map((r) => ({
      uid: r.uid,
      score: dailyScore(r.points, streakAsOf(solvedSetFor(guildId, r.player_id), puzzleNum)),
    }));
  const players = countPuzzlePlayers.get(guildId, GAME, String(puzzleId)).n;
  return { crowns, players };
}

/**
 * Points leaderboard for a guild: total score (Σ base + streak over wins),
 * crowns, games and wins per player, sorted by total points descending.
 */
export function getConnectionsLeaderboard(guildId) {
  const byPlayer = new Map();
  for (const r of selectAllConnections.all(guildId, GAME)) {
    if (!byPlayer.has(r.player_id)) {
      byPlayer.set(r.player_id, { uid: r.uid, rows: [] });
    }
    byPlayer.get(r.player_id).rows.push(r);
  }

  const out = [];
  for (const { uid, rows } of byPlayer.values()) {
    const solvedSet = new Set(
      rows.filter((r) => r.score !== null).map((r) => Number(r.puzzle_id)),
    );
    let totalPoints = 0;
    let crowns = 0;
    let wins = 0;
    for (const r of rows) {
      if (r.is_crown) crowns++;
      if (r.score !== null) {
        wins++;
        totalPoints += dailyScore(r.points, streakAsOf(solvedSet, Number(r.puzzle_id)));
      }
    }
    out.push({ uid, totalPoints, crowns, games: rows.length, wins });
  }

  out.sort((a, b) => b.totalPoints - a.totalPoints);
  return out;
}

/**
 * Per-player Connections stats for the /stats embed, or null if no data.
 */
export function getConnectionsStats(guildId, userId) {
  const rows = selectPlayerConnections.all(guildId, GAME, userId);
  if (rows.length === 0) return null;

  const solvedSet = new Set(
    rows.filter((r) => r.score !== null).map((r) => Number(r.puzzle_id)),
  );

  let totalPoints = 0;
  let wins = 0;
  let crowns = 0;
  let mistakesTotal = 0;
  let purpleFirsts = 0;
  let reverseRainbows = 0;

  for (const r of rows) {
    if (r.is_crown) crowns++;
    if (r.score === null) continue; // loss
    wins++;
    mistakesTotal += r.score;
    const d = r.details ? JSON.parse(r.details) : {};
    if (d.purpleFirst) purpleFirsts++;
    if (d.reverseRainbow) reverseRainbows++;
    const ds = dailyScore(r.points, streakAsOf(solvedSet, Number(r.puzzle_id)));
    totalPoints += ds;
  }

  // Anchored to the most recent puzzle *played*, so a recent loss breaks it.
  const latestPlayed = Math.max(...rows.map((r) => Number(r.puzzle_id)));
  const currentStreak = streakAsOf(solvedSet, latestPlayed);

  return {
    totalPoints,
    games: rows.length,
    wins,
    crowns,
    avgMistakes: wins ? mistakesTotal / wins : 0,
    currentStreak,
    purpleFirsts,
    reverseRainbows,
  };
}
