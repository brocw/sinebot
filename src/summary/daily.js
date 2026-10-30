import { standings, nameOf } from "../utils/standings.js";
import { sameRank, ordinal } from "../utils/leaderboard.js";
import { inSemester, formatSemester } from "../utils/semesters.js";
import { joinNames } from "../games/puzzleNumber.js";

// The daily summary, as data. Everything here folds `store.getSeries()` rows —
// the same rows /crowns, /semester and /graph read — so a result counts in the
// summary exactly as it counts everywhere else, and nothing new is stored.
//
// Pure apart from each game's optional `daily()` hook, which Wordle uses for
// its word lookup. Rendering to Discord components lives in `render.js`.

const DAY_MS = 86_400_000;

/** Places shown on a day's podium, and the board places a climb is called out for. */
export const PODIUM = 3;

/** The shortest run whose end is worth announcing. */
export const STREAK_FLOOR = 5;

/**
 * How a game's rows map onto days, and which day the summary is about.
 *
 * A self-report day is its puzzle number, and puzzle numbers advance one per
 * calendar day, so the day before `d` is always `d - 1` — the same walk the
 * store's own streaks take.
 *
 * An aggregate game's rows carry the upstream post's timestamp instead, and
 * the day before is the previous day the group *posted*: a date the upstream
 * bot never posted is an outage, not a miss, which is the rule the aggregate
 * store's streaks follow.
 *
 * @returns {{ day: number, keyOf: (row) => number, prev: (day: number) => number|null }}
 */
export function dayFrame(game, rows, date) {
  if (game.kind === "self-report") {
    return {
      day: game.puzzleNumberFor(date) - 1,
      keyOf: (r) => Number(r.puzzleId),
      prev: (d) => d - 1,
    };
  }

  const keyOf = (r) => Math.floor(r.ts / DAY_MS);
  const days = [...new Set(rows.map(keyOf))].sort((a, b) => a - b);
  const index = new Map(days.map((d, i) => [d, i]));
  return {
    day: Math.floor(date.getTime() / DAY_MS),
    keyOf,
    prev(d) {
      const i = index.get(d);
      if (i !== undefined) return i > 0 ? days[i - 1] : null;
      return days.findLast((k) => k < d) ?? null;
    },
  };
}

/**
 * One game's section of the summary: its header, podium and stats, plus the
 * rows the callouts are worked out from. Null when nobody played that day, so
 * the game drops out of the post.
 *
 * @param {object} game     registry entry
 * @param {object[]} rows   the guild's `store.getSeries()` rows for this game
 * @param {Date} date       when the summary is posted — it reports the day before
 * @param {object|null} parsed  the upstream message, for the game that posted it
 */
export async function gameDay(game, rows, date, parsed = null) {
  const frame = dayFrame(game, rows, date);
  const dayRows = rows.filter((r) => frame.keyOf(r) === frame.day);
  if (dayRows.length === 0) return null;

  // The upstream bot posts the morning after, so its results — like every
  // self-report game's — are yesterday's.
  const puzzle = game.puzzleNumberFor ? String(game.puzzleNumberFor(date) - 1) : null;
  const extra = (await game.daily?.({ rows: dayRows, parsed, date, puzzle })) ?? {};

  const lost = dayRows.filter((r) => r.score === null).length;

  return {
    game,
    frame,
    rows,
    dayRows,
    title: titleOf(game, puzzle),
    intro: extra.intro ?? [],
    podium: podiumOf(dayRows, game),
    stats: [`${dayRows.length} played`, ...(lost ? [`${lost} ❌`] : []), ...(extra.stats ?? [])],
  };
}

function titleOf(game, puzzle) {
  if (puzzle === null) return `${game.emoji} ${game.label}`;
  const named = game.puzzleLabel ? game.puzzleLabel(puzzle) : `#${puzzle}`;
  return `${game.emoji} ${game.label} ${named}`;
}

/**
 * The day's top places among those who solved it. Both stores share a place
 * between tied players, so a place is a group of names behind one result.
 */
function podiumOf(dayRows, game) {
  const label = game.resultLabel ?? ((r) => `${r.points} pts`);
  const places = new Map();
  for (const r of dayRows) {
    if (r.score === null || r.place == null || r.place > PODIUM) continue;
    const group = places.get(r.place);
    if (group) group.push(r);
    else places.set(r.place, [r]);
  }
  return [...places]
    .sort(([a], [b]) => a - b)
    .map(([place, rs]) => ({ place, result: label(rs[0]), names: rs.map(nameOf) }));
}

/** Shared ranks, the way `rankedLines` numbers a board: 1, 1, 3. */
function ranksOf(entries, game) {
  const ranks = new Map();
  let rank = 0;
  entries.forEach((e, i) => {
    if (i === 0 || !sameRank(game, entries[i - 1], e)) rank = i + 1;
    ranks.set(e.playerKey, rank);
  });
  return ranks;
}

/**
 * What one day did to a board: compares it ranked without the day's rows and
 * with them.
 *
 * - `dethrone` — nobody who led before leads now.
 * - `level` — the leaders kept the top, but someone new tied them there.
 * - `climb` — someone moved into a better podium place, overtaking `passed`.
 *
 * A board that was empty before the day has no order to upset, so it yields
 * nothing — the first day of a semester crowns no usurper.
 */
export function boardChanges(before, after, game) {
  if (before.length === 0 || after.length === 0) return [];

  const was = ranksOf(before, game);
  const now = ranksOf(after, game);
  const entryOf = new Map([...before, ...after].map((e) => [e.playerKey, e]));
  const leaders = (ranks) => [...ranks].filter(([, r]) => r === 1).map(([k]) => k);
  const oldTop = leaders(was);
  const newTop = leaders(now);

  const events = [];
  const covered = new Set();

  if (!newTop.some((k) => oldTop.includes(k))) {
    events.push({
      kind: "dethrone",
      who: newTop.map((k) => entryOf.get(k)),
      from: oldTop.map((k) => entryOf.get(k)),
    });
    newTop.forEach((k) => covered.add(k));
  } else {
    const joined = newTop.filter((k) => !oldTop.includes(k));
    if (joined.length) {
      events.push({
        kind: "level",
        who: joined.map((k) => entryOf.get(k)),
        from: oldTop.filter((k) => newTop.includes(k)).map((k) => entryOf.get(k)),
      });
      joined.forEach((k) => covered.add(k));
    }
  }

  for (const e of after) {
    const rank = now.get(e.playerKey);
    if (rank > PODIUM) break;
    if (covered.has(e.playerKey)) continue;

    const from = was.get(e.playerKey) ?? Infinity;
    if (rank >= from) continue;

    // Only the players they actually went past. A rank can also improve
    // because two people above fell level, which overtakes nobody.
    const passed = before.filter(
      (p) => was.get(p.playerKey) < from && (now.get(p.playerKey) ?? Infinity) > rank,
    );
    if (passed.length) events.push({ kind: "climb", who: [e], rank, passed });
  }

  return events;
}

/** Players whose run of solved days ended on the summarised day, longest first. */
export function streakEnds({ frame, rows }) {
  const before = frame.prev(frame.day);
  if (before === null) return [];

  const players = new Map();
  for (const r of rows) {
    let p = players.get(r.playerKey);
    if (!p) {
      p = { entry: r, solved: new Set(), played: false };
      players.set(r.playerKey, p);
    }
    const key = frame.keyOf(r);
    if (r.score !== null) p.solved.add(key);
    if (key === frame.day) p.played = true;
  }

  const out = [];
  for (const { entry, solved, played } of players.values()) {
    if (solved.has(frame.day)) continue;
    let streak = 0;
    for (let d = before; d !== null && solved.has(d); d = frame.prev(d)) streak++;
    if (streak >= STREAK_FLOOR) out.push({ entry, streak, lost: played });
  }
  return out.sort((a, b) => b.streak - a.streak);
}

/** A first crown, a 10th, and every 25th after that. */
const isMilestone = (n) => n === 1 || n === 10 || n % 25 === 0;

/** Crown winners on the day whose tally just reached a milestone. */
export function crownMilestones({ frame, rows, dayRows }) {
  const out = [];
  for (const r of dayRows) {
    if (!r.isCrown) continue;
    const count = rows.filter(
      (x) => x.playerKey === r.playerKey && x.isCrown && frame.keyOf(x) <= frame.day,
    ).length;
    if (isMilestone(count)) out.push({ entry: r, count });
  }
  return out;
}

/** Discord users who took the crown in every game on the post, given two or more. */
export function sweeps(days) {
  if (days.length < 2) return [];
  const crowned = days.map(
    (d) => new Set(d.dayRows.filter((r) => r.isCrown && r.playerType === "id").map((r) => r.playerKey)),
  );
  const [first, ...rest] = crowned;
  return days[0].dayRows.filter(
    (r) => r.isCrown && first.has(r.playerKey) && rest.every((s) => s.has(r.playerKey)),
  );
}

const verb = (who, one, many) => (who.length === 1 ? one : many);
const names = (entries) => joinNames(entries.map(nameOf));

/** "the all-time Wordle board", "the all-time and Fall 2026 Wordle boards". */
function whereOf(boards, game) {
  return `the ${joinNames(boards)} ${game.label} board${boards.length === 1 ? "" : "s"}`;
}

function eventText(event, game) {
  const where = whereOf(event.boards, game);
  const { who } = event;
  switch (event.kind) {
    case "dethrone":
      return `${names(who)} ${verb(who, "knocks", "knock")} ${names(event.from)} off the top of ${where}.`;
    case "level":
      return `🤝 ${names(who)} ${verb(who, "draws", "draw")} level with ${names(event.from)} at the top of ${where}.`;
    default:
      return `📈 ${names(who)} passes ${names(event.passed)} for ${ordinal(event.rank)} on ${where}.`;
  }
}

/**
 * The same change on both boards is one callout naming both, not two: a new
 * all-time leader early in a semester has usually taken that board too.
 */
function mergeBoards(perBoard) {
  const merged = new Map();
  for (const { label, events } of perBoard) {
    for (const e of events) {
      const key = [
        e.kind,
        e.rank ?? "",
        ...[e.who, e.from ?? [], e.passed ?? []].map((xs) => xs.map((x) => x.playerKey).join(",")),
      ].join("|");
      const seen = merged.get(key);
      if (seen) seen.boards.push(label);
      else merged.set(key, { ...e, boards: [label] });
    }
  }
  return [...merged.values()];
}

/**
 * Everything worth calling out across the day's games.
 *
 * Dethronings come back on their own, since the post gives each one a card of
 * its own; the rest are one list of lines, most notable first.
 *
 * @param {object[]} days  `gameDay()` results
 * @param {{ semester: object }} opts  the semester whose board is compared
 * @returns {{ dethrones: { game: object, who: object[], text: string }[], highlights: string[] }}
 */
export function dailyCallouts(days, { semester }) {
  const dethrones = [];
  const moves = [];
  const milestones = [];
  const ended = [];

  for (const day of days) {
    const { game, frame, rows } = day;
    const board = (rs) => ({
      before: standings(rs.filter((r) => frame.keyOf(r) !== frame.day), game),
      after: standings(rs, game),
    });
    const perBoard = [
      { label: "all-time", rows },
      { label: formatSemester(semester), rows: rows.filter((r) => inSemester(r.ts, semester)) },
    ].map(({ label, rows: rs }) => {
      const { before, after } = board(rs);
      return { label, events: boardChanges(before, after, game) };
    });

    for (const event of mergeBoards(perBoard)) {
      if (event.kind === "dethrone") {
        dethrones.push({ game, who: event.who, text: eventText(event, game) });
      } else {
        moves.push(eventText(event, game));
      }
    }

    for (const { entry, count } of crownMilestones(day)) {
      milestones.push(
        count === 1
          ? `🎉 ${nameOf(entry)} takes their first ever ${game.label} crown.`
          : `🎉 ${nameOf(entry)} reaches **${count}** ${game.label} crowns.`,
      );
    }

    for (const { entry, streak, lost } of streakEnds(day)) {
      ended.push(
        `💔 ${nameOf(entry)}'s **${streak}-day** ${game.label} streak ended` +
          (lost ? " with a loss." : "."),
      );
    }
  }

  const swept = sweeps(days).map(
    (r) =>
      `👑 ${nameOf(r)} swept every crown: ${joinNames(days.map((d) => d.game.label))}.`,
  );

  return { dethrones, highlights: [...swept, ...moves, ...milestones, ...ended] };
}
