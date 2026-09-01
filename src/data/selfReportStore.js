import { db, tx } from "./db.js";
import { mean, median, stdev, timeBreakdown } from "../utils/stats.js";

// Storage for "self-report" games — every player posts their own result, so the
// message author *is* the player and there is no name/alias machinery. This is
// the shape most daily puzzle games take (Connections, Strands, Mini, Framed…),
// so a new game supplies only a parser and a scoring spec; everything below —
// dedup, placement, crowns, streaks, leaderboards, stats — comes for free.
//
// Statements are prepared once at module scope and take `game` as a parameter,
// so registering more games costs no extra prepared statements.

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
  `SELECT result_id, player_id, score, points
   FROM results WHERE guild_id = ? AND game = ? AND puzzle_id = ?`,
);
const selectSolvedForPlayer = db.prepare(
  `SELECT puzzle_id FROM results
   WHERE guild_id = ? AND game = ? AND player_id = ? AND score IS NOT NULL`,
);
const selectPuzzlesFrom = db.prepare(
  `SELECT DISTINCT puzzle_id FROM results
   WHERE guild_id = ? AND game = ? AND CAST(puzzle_id AS INTEGER) >= ?`,
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
const selectAll = db.prepare(
  `SELECT p.discord_user_id AS uid, r.player_id, r.puzzle_id, r.score, r.points,
          r.is_crown, r.place, r.details, r.ts
   FROM results r
   JOIN players p ON p.player_id = r.player_id
   WHERE r.guild_id = ? AND r.game = ?
   ORDER BY r.ts`,
);
const selectForPlayer = db.prepare(
  `SELECT r.puzzle_id, r.score, r.points, r.is_crown, r.place, r.details, r.ts
   FROM results r
   JOIN players p ON p.player_id = r.player_id
   WHERE r.guild_id = ? AND r.game = ? AND p.discord_user_id = ?`,
);

function getOrCreateIdPlayer(guildId, discordUserId) {
  const row = selectPlayerByUid.get(guildId, discordUserId);
  if (row) return row.player_id;
  return insertIdPlayer.run(guildId, discordUserId).lastInsertRowid;
}

/**
 * Consecutive solved days ending at `puzzleNum`. Puzzle numbers advance one per
 * calendar day, so consecutive numbers are consecutive days. Returns 0 when
 * `puzzleNum` itself was not solved.
 */
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
 * Creates a store bound to one game.
 *
 * @param {string} game  registry id, e.g. "connections"
 * @param {{
 *   basePoints: (parsed: object) => number,
 *   dailyScore: (base: number, streak: number) => number,
 *   scoreOf: (parsed: object) => number|null,   // null means "did not solve"
 *   detailsOf: (parsed: object) => object,      // game-specific extras, stored as JSON
 *   extraStats?: (rows: object[]) => object,    // folded into getStats() output
 * }} spec
 */
export function createSelfReportStore(game, spec) {
  const { basePoints, dailyScore, scoreOf, detailsOf, extraStats } = spec;

  // Solved-puzzle sets are read once per player per pass and reused. Without
  // this every ranked row triggered its own query.
  function solvedSets(guildId) {
    const cache = new Map();
    return (playerId) => {
      let set = cache.get(playerId);
      if (!set) {
        set = new Set(
          selectSolvedForPlayer
            .all(guildId, game, playerId)
            .map((r) => Number(r.puzzle_id)),
        );
        cache.set(playerId, set);
      }
      return set;
    };
  }

  /**
   * Recomputes crown + place for one puzzle, ranking by full daily score (base
   * points plus that player's streak as of this puzzle). Placement is relative,
   * so it shifts as more players post. Ties share a place, and every solver
   * tied for the top score takes a crown. Nobody solved it => no crown.
   */
  function recomputePuzzle(guildId, puzzleId, getSolved) {
    const puzzleNum = Number(puzzleId);
    const scored = selectPuzzleResults.all(guildId, game, puzzleId).map((r) => ({
      result_id: r.result_id,
      ds:
        r.score !== null
          ? dailyScore(r.points, streakAsOf(getSolved(r.player_id), puzzleNum))
          : 0,
    }));

    const best = Math.max(0, ...scored.map((s) => s.ds));

    const ranked = [...scored].sort((a, b) => b.ds - a.ds);
    let place = 0;
    let prev = null;
    ranked.forEach((r, i) => {
      if (r.ds !== prev) {
        place = i + 1;
        prev = r.ds;
      }
      updateRank.run(best > 0 && r.ds === best ? 1 : 0, place, r.result_id);
    });
  }

  /**
   * Recomputes `fromPuzzle` and every later puzzle.
   *
   * A streak is a backward walk over solved puzzles, so recording a result
   * retroactively changes the daily score of every *subsequent* puzzle that
   * player solved — and with it the crown for those days. Recomputing only the
   * puzzle just posted left those later days stale.
   */
  function recomputeFrom(guildId, fromPuzzle) {
    const getSolved = solvedSets(guildId);
    for (const { puzzle_id } of selectPuzzlesFrom.all(
      guildId,
      game,
      Number(fromPuzzle),
    )) {
      recomputePuzzle(guildId, puzzle_id, getSolved);
    }
  }

  /**
   * Records one live result and restandardises the affected puzzles.
   *
   * @returns {{ base: number, streak: number, total: number } | null}
   *   scoring detail when newly recorded; null if it was a duplicate message or
   *   a re-share of a puzzle this player already logged.
   */
  function record(guildId, parsed, discordUserId, messageId, ts) {
    return tx(() => {
      if (isProcessed.get(guildId, game, messageId)) return null;

      const puzzleId = String(parsed.puzzle);
      const playerId = getOrCreateIdPlayer(guildId, discordUserId);

      // A player counts once per puzzle, no matter how often they paste it.
      if (selectPlayerPuzzle.get(guildId, game, puzzleId, playerId)) {
        markProcessed.run(guildId, game, messageId);
        return null;
      }

      const base = basePoints(parsed);
      insertResult.run(
        guildId,
        game,
        playerId,
        puzzleId,
        scoreOf(parsed),
        base,
        JSON.stringify(detailsOf(parsed)),
        messageId,
        ts,
      );
      markProcessed.run(guildId, game, messageId);
      recomputeFrom(guildId, puzzleId);

      const getSolved = solvedSets(guildId);
      const streak = scoreOf(parsed) !== null
        ? streakAsOf(getSolved(playerId), parsed.puzzle)
        : 0;
      return { base, streak, total: dailyScore(base, streak) };
    });
  }

  /**
   * Rebuilds a guild's history for this game from scanned messages.
   *
   * @param {{ parsed: object, userId: string, messageId: string, ts: number }[]} entries oldest-first
   * @returns {number} results recorded
   */
  function rebuild(guildId, entries) {
    return tx(() => {
      deleteResultsForGame.run(guildId, game);
      deleteProcessedForGame.run(guildId, game);
      deleteOrphanPlayers.run(guildId, guildId);

      const seen = new Set();
      const puzzles = new Set();
      let count = 0;

      for (const { parsed, userId, messageId, ts } of entries) {
        const puzzleId = String(parsed.puzzle);
        const playerId = getOrCreateIdPlayer(guildId, userId);
        const dedupKey = `${playerId}|${puzzleId}`;
        if (seen.has(dedupKey)) {
          markProcessed.run(guildId, game, messageId);
          continue;
        }
        seen.add(dedupKey);

        insertResult.run(
          guildId,
          game,
          playerId,
          puzzleId,
          scoreOf(parsed),
          basePoints(parsed),
          JSON.stringify(detailsOf(parsed)),
          messageId,
          ts,
        );
        markProcessed.run(guildId, game, messageId);
        puzzles.add(puzzleId);
        count++;
      }

      // Every row is in place, so one pass over the affected puzzles with a
      // shared cache settles all placements.
      const getSolved = solvedSets(guildId);
      for (const puzzleId of puzzles) {
        recomputePuzzle(guildId, puzzleId, getSolved);
      }
      return count;
    });
  }

  /**
   * Crown winner(s) and player count for one puzzle, for the daily summary.
   * Each winner's `score` is their full daily score (base + streak).
   */
  function getPuzzleCrowns(guildId, puzzleId) {
    const puzzleNum = Number(puzzleId);
    const getSolved = solvedSets(guildId);
    const crowns = selectPuzzleCrownRows
      .all(guildId, game, String(puzzleId))
      .map((r) => ({
        uid: r.uid,
        score: dailyScore(r.points, streakAsOf(getSolved(r.player_id), puzzleNum)),
      }));
    return {
      crowns,
      players: countPuzzlePlayers.get(guildId, game, String(puzzleId)).n,
    };
  }

  // Groups a guild's rows by player and attaches each player's solved set once.
  function byPlayer(guildId) {
    const map = new Map();
    for (const r of selectAll.all(guildId, game)) {
      let entry = map.get(r.player_id);
      if (!entry) {
        entry = { uid: r.uid, rows: [] };
        map.set(r.player_id, entry);
      }
      entry.rows.push(r);
    }
    for (const entry of map.values()) {
      entry.solved = new Set(
        entry.rows.filter((r) => r.score !== null).map((r) => Number(r.puzzle_id)),
      );
    }
    return map;
  }

  /** Points leaderboard, highest total first. */
  function getLeaderboard(guildId) {
    const out = [];
    for (const { uid, rows, solved } of byPlayer(guildId).values()) {
      let totalPoints = 0;
      let crowns = 0;
      let wins = 0;
      for (const r of rows) {
        if (r.is_crown) crowns++;
        if (r.score === null) continue;
        wins++;
        totalPoints += dailyScore(r.points, streakAsOf(solved, Number(r.puzzle_id)));
      }
      out.push({ uid, totalPoints, crowns, games: rows.length, wins });
    }
    out.sort((a, b) => b.totalPoints - a.totalPoints);
    return out;
  }

  /** Per-player stats for the /stats embed, or null when the player has no data. */
  function getStats(guildId, userId) {
    const rows = selectForPlayer.all(guildId, game, userId);
    if (rows.length === 0) return null;

    const solved = new Set(
      rows.filter((r) => r.score !== null).map((r) => Number(r.puzzle_id)),
    );

    // A loss scores 0 points, which is a real number and belongs in the points
    // mean. It carries no `score` (no mistake count, no guess count), so it
    // stays out of avgScore/median/stdev — those describe solved days only.
    const pointsFor = (r) =>
      r.score === null
        ? 0
        : dailyScore(r.points, streakAsOf(solved, Number(r.puzzle_id)));

    let totalPoints = 0;
    let crowns = 0;
    const solvedScores = [];
    for (const r of rows) {
      if (r.is_crown) crowns++;
      totalPoints += pointsFor(r);
      if (r.score !== null) solvedScores.push(r.score);
    }
    const wins = solvedScores.length;

    // Anchored to the most recent puzzle *played*, so a recent loss breaks it.
    const latestPlayed = Math.max(...rows.map((r) => Number(r.puzzle_id)));

    const { byWeekday, byMonth } = timeBreakdown(rows, { pointsOf: pointsFor });

    return {
      totalPoints,
      games: rows.length,
      wins,
      crowns,
      avgScore: mean(solvedScores) ?? 0,
      avgPoints: rows.length ? totalPoints / rows.length : 0,
      medianScore: median(solvedScores),
      stdevScore: stdev(solvedScores),
      currentStreak: streakAsOf(solved, latestPlayed),
      byWeekday,
      byMonth,
      ...(extraStats ? extraStats(rows) : {}),
    };
  }

  /**
   * Flat time series for charting: one entry per recorded result, carrying the
   * full daily score so points-based metrics need no further lookups.
   */
  function getSeries(guildId) {
    const out = [];
    for (const { uid, rows, solved } of byPlayer(guildId).values()) {
      for (const r of rows) {
        out.push({
          playerKey: uid,
          playerType: "id",
          displayName: null,
          ts: r.ts,
          puzzleId: r.puzzle_id,
          score: r.score,
          isCrown: r.is_crown === 1,
          place: r.place,
          points:
            r.score === null
              ? 0
              : dailyScore(r.points, streakAsOf(solved, Number(r.puzzle_id))),
        });
      }
    }
    return out.sort((a, b) => a.ts - b.ts);
  }

  return {
    record,
    rebuild,
    getPuzzleCrowns,
    getLeaderboard,
    getStats,
    getSeries,
  };
}
