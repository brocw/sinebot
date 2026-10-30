import { timeBreakdown } from "./stats.js";
import { etDayKey } from "./semesters.js";

// Leaderboards over a window of time, folded out of `store.getSeries()` rows.
//
// Both stores already emit the same series row — playerKey, playerType,
// displayName, ts, score, points, isCrown, place — and for self-report games
// `points` is the full daily score with the streak bonus already in it. So a
// windowed board needs no new query, no new column and no store change: filter
// the rows, fold them, and hand the result to the leaderboard hooks each game
// already declares.
//
// Pure: rows in, entries out.

/**
 * One entry per player, carrying the superset of what both stores'
 * `getLeaderboard()` produce.
 *
 * The superset matters: it is exactly the set of fields `leaderboardLine`,
 * `leaderboardRankKey`, `leaderboardFilter` and `leaderboardSummary` read
 * today, which is what lets a semester board render through the same hooks as
 * the all-time one. `test/standings.test.js` pins that down by asserting an
 * unwindowed fold renders identically to `getLeaderboard()`.
 */
export function foldSeries(rows) {
  const map = new Map();

  for (const r of rows) {
    let e = map.get(r.playerKey);
    if (!e) {
      e = {
        playerKey: r.playerKey,
        playerType: r.playerType,
        displayName: r.displayName,
        uid: r.playerType === "id" ? r.playerKey : null,
        totalPoints: 0,
        crowns: 0,
        silver: 0,
        bronze: 0,
        games: 0,
        wins: 0,
      };
      map.set(r.playerKey, e);
    }

    e.games++;
    if (r.score !== null) e.wins++;
    if (r.isCrown) e.crowns++;
    if (r.place === 2) e.silver++;
    if (r.place === 3) e.bronze++;
    // A loss carries 0 points, and an aggregate game carries none at all.
    e.totalPoints += r.points ?? 0;
  }

  return [...map.values()];
}

/**
 * The board for a set of rows, filtered and ranked the way this game ranks its
 * own — points for Connections and Minute Cryptic, crowns for Wordle.
 */
export function standings(rows, game) {
  return foldSeries(rows)
    .filter(game.leaderboardFilter)
    .sort((a, b) => game.leaderboardRankKey(b) - game.leaderboardRankKey(a));
}

/** How a player is named in prose, as `leaderboardLine` names them in a list. */
export function nameOf(entry) {
  return entry.playerType === "id" ? `<@${entry.playerKey}>` : entry.displayName;
}

/**
 * The champion(s) and how decisively they won.
 *
 * Everyone tied on the top measure is a champion, the way tied crowns already
 * share a day. `gap` is the distance to the best score that isn't theirs, and
 * is null when nobody else is on the board.
 *
 * @returns {{ champions: object[], gap: number|null, runnerUp: object|null }}
 */
export function champions(entries, game) {
  if (entries.length === 0) return { champions: [], gap: null, runnerUp: null };

  const key = (e) => game.leaderboardRankKey(e);
  const top = key(entries[0]);
  const winners = entries.filter((e) => key(e) === top);
  const runnerUp = entries.find((e) => key(e) !== top) ?? null;

  return {
    champions: winners,
    runnerUp,
    gap: runnerUp ? top - key(runnerUp) : null,
  };
}

/** Rows grouped by the Eastern-time day they fall on, oldest day first. */
function byDay(rows) {
  const map = new Map();
  for (const r of rows) {
    const day = etDayKey(r.ts);
    const bucket = map.get(day);
    if (bucket) bucket.push(r);
    else map.set(day, [r]);
  }
  return [...map].sort(([a], [b]) => a.localeCompare(b));
}

/**
 * How often the lead changed hands over the window.
 *
 * The board is re-folded after each day and asked who is on top. A tie that
 * still includes the standing leader is not a change — they haven't lost it.
 *
 * @returns {{ changes: number, leader: string|null }}
 */
export function leadChanges(rows, game) {
  const key = (e) => game.leaderboardRankKey(e);
  const seen = [];
  let leader = null;
  let changes = 0;

  for (const [, dayRows] of byDay(rows)) {
    seen.push(...dayRows);
    const entries = standings(seen, game);
    if (entries.length === 0) continue;

    const top = key(entries[0]);
    const tied = entries.filter((e) => key(e) === top).map((e) => e.playerKey);

    if (leader === null) leader = tied[0];
    else if (!tied.includes(leader)) {
      changes++;
      leader = tied[0];
    }
  }

  return { changes, leader };
}

/**
 * How much of the window each player turned up for.
 *
 * The denominator is the days *anybody* recorded a result, not the days in the
 * window: a day nobody played is a day the game didn't run here, and it is not
 * held against anyone. That is the rule Wordle streaks already follow.
 *
 * @returns {{ playerKey: string, playerType: string, displayName: string|null,
 *             days: number, of: number, rate: number }[]} busiest first
 */
export function participation(rows) {
  const all = new Set();
  const perPlayer = new Map();

  for (const r of rows) {
    const day = etDayKey(r.ts);
    all.add(day);

    let entry = perPlayer.get(r.playerKey);
    if (!entry) {
      entry = {
        playerKey: r.playerKey,
        playerType: r.playerType,
        displayName: r.displayName,
        days: new Set(),
      };
      perPlayer.set(r.playerKey, entry);
    }
    entry.days.add(day);
  }

  const of = all.size;
  return [...perPlayer.values()]
    .map(({ days, ...rest }) => ({
      ...rest,
      days: days.size,
      of,
      rate: of ? days.size / of : 0,
    }))
    .sort((a, b) => b.days - a.days);
}

// A player has to have shown up in both windows before a comparison between
// them says anything. Five days is the same order as the per-bucket floors in
// statFields and periods.js.
const MIN_DAYS = 5;

/**
 * Each player's headline measure this window against their own last one.
 *
 * Compared as a **per-day average, not a total**: the semesters are 110 to 130
 * days long and people play different amounts of them, so totals would mostly
 * measure who was around more. `periodMetric` is already the game's declaration
 * of which average matters and which end of it is good, so improvement reads
 * that rather than inventing a second ranking rule.
 *
 * @returns {{ playerKey: string, from: number, to: number, delta: number }[]}
 *   most improved first; `delta` is positive when the player got better,
 *   whichever direction that is for this game.
 */
export function improvement(currentRows, previousRows, game) {
  const metric = game.periodMetric;
  if (!metric) return [];

  // timeBreakdown's `overall` bucket is the same shape /periods ranks, so the
  // value under metric.by means the same thing in both places.
  const bucketsOf = (rows) => {
    const perPlayer = new Map();
    for (const r of rows) {
      const bucket = perPlayer.get(r.playerKey);
      if (bucket) bucket.push(r);
      else perPlayer.set(r.playerKey, [r]);
    }
    return new Map(
      [...perPlayer].map(([key, rs]) => [
        key,
        { rows: rs, overall: timeBreakdown(rs, { crownOf: (r) => r.isCrown }).overall },
      ]),
    );
  };

  const now = bucketsOf(currentRows);
  const before = bucketsOf(previousRows);
  const out = [];

  for (const [key, cur] of now) {
    const prev = before.get(key);
    if (!prev) continue;
    if (cur.overall.plays < MIN_DAYS || prev.overall.plays < MIN_DAYS) continue;

    const from = prev.overall[metric.by];
    const to = cur.overall[metric.by];
    if (from === null || to === null) continue;

    const [row] = cur.rows;
    out.push({
      playerKey: key,
      playerType: row.playerType,
      displayName: row.displayName,
      from,
      to,
      delta: metric.direction === "lower" ? from - to : to - from,
    });
  }

  return out.sort((a, b) => b.delta - a.delta);
}
