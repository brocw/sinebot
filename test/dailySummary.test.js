import test from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";

import {
  gameDay,
  boardChanges,
  streakEnds,
  crownMilestones,
  sweeps,
  dailyCallouts,
} from "../src/summary/daily.js";
import { renderDailySummary, TEXT_LIMIT } from "../src/summary/render.js";
import { standings, nameOf } from "../src/utils/standings.js";
import { semesterOf } from "../src/utils/semesters.js";

// Stand-in games, so the summary is tested on its own terms rather than through
// whichever real game's scoring happens to suit the assertion. Neither touches
// the database: gameDay and the callouts take series rows directly.

const DAY_MS = 86_400_000;
// Puzzle 1 runs on 1 September 2026, so the whole file sits inside Fall.
const START = Date.parse("2026-09-01T16:00:00Z");
const tsOf = (puzzle) => START + (puzzle - 1) * DAY_MS;

/** The summary for puzzle `n` is posted the day after it. */
const postedAfter = (puzzle) => new Date(tsOf(puzzle + 1));

const POINTS_GAME = {
  id: "points",
  label: "Points",
  emoji: "🅿️",
  color: 0x123456,
  kind: "self-report",
  puzzleNumberFor: (date) => Math.floor((date.getTime() - START) / DAY_MS) + 1,
  leaderboardFilter: (e) => e.games > 0,
  leaderboardRankKey: (e) => e.totalPoints,
};

const CROWN_GAME = {
  id: "crowns",
  label: "Crowns",
  emoji: "👑",
  color: 0x654321,
  kind: "aggregate",
  leaderboardFilter: (e) => e.crowns > 0,
  leaderboardRankKey: (e) => e.crowns,
  resultLabel: (r) => `${r.score}/6`,
};

/** One series row, in the shape both stores' getSeries() emit. */
function row(playerKey, puzzle, { points = 10, score = 1, place = 1, isCrown = false, ts } = {}) {
  return {
    playerKey,
    playerType: "id",
    displayName: null,
    ts: ts ?? tsOf(puzzle),
    puzzleId: String(puzzle),
    score,
    points,
    place,
    isCrown,
    details: {},
  };
}

/** Solved rows for `player` on every puzzle from `from` to `to`. */
const run = (player, from, to, opts) =>
  Array.from({ length: to - from + 1 }, (_, i) => row(player, from + i, opts));

const keys = (entries) => entries.map((e) => e.playerKey);

// --- board changes ----------------------------------------------------------

/** The board without puzzle `day`'s rows, and with them. */
function boards(rows, day) {
  return [
    standings(rows.filter((r) => Number(r.puzzleId) !== day), POINTS_GAME),
    standings(rows, POINTS_GAME),
  ];
}

test("taking the top from the leader is a dethroning", () => {
  const rows = [row("a", 1, { points: 100 }), row("b", 1, { points: 90 }), row("b", 2, { points: 20 })];
  const [event] = boardChanges(...boards(rows, 2), POINTS_GAME);

  assert.equal(event.kind, "dethrone");
  assert.deepEqual(keys(event.who), ["b"]);
  assert.deepEqual(keys(event.from), ["a"]);
});

test("drawing level with the leader is not a dethroning", () => {
  const rows = [row("a", 1, { points: 100 }), row("b", 1, { points: 90 }), row("b", 2, { points: 10 })];
  const events = boardChanges(...boards(rows, 2), POINTS_GAME);

  assert.deepEqual(
    events.map((e) => [e.kind, keys(e.who), keys(e.from)]),
    [["level", ["b"], ["a"]]],
  );
});

test("a climb names who was overtaken and the place taken", () => {
  const rows = [
    row("a", 1, { points: 100 }),
    row("b", 1, { points: 90 }),
    row("c", 1, { points: 85 }),
    row("c", 2, { points: 10 }),
  ];
  const events = boardChanges(...boards(rows, 2), POINTS_GAME);

  assert.deepEqual(
    events.map((e) => [e.kind, keys(e.who), e.rank, keys(e.passed)]),
    [["climb", ["c"], 2, ["b"]]],
  );
});

test("moves below the podium are not called out", () => {
  const rows = [
    ...["a", "b", "c"].map((p, i) => row(p, 1, { points: 100 - i })),
    row("d", 1, { points: 50 }),
    row("e", 1, { points: 40 }),
    row("e", 2, { points: 20 }),
  ];
  assert.deepEqual(boardChanges(...boards(rows, 2), POINTS_GAME), []);
});

test("a board that was empty before the day has nobody to dethrone", () => {
  const rows = [row("a", 1, { points: 100 })];
  assert.deepEqual(boardChanges(...boards(rows, 1), POINTS_GAME), []);
});

// --- streaks ------------------------------------------------------------------

test("a long run ends with a loss or a missed day, longest first", async () => {
  const rows = [
    ...run("missed", 1, 9),
    ...run("lost", 4, 9),
    row("lost", 10, { score: null, points: 0 }),
    ...run("short", 7, 9),
    ...run("kept", 1, 10),
  ];
  const day = await gameDay(POINTS_GAME, rows, postedAfter(10));

  assert.deepEqual(
    streakEnds(day).map((s) => [s.entry.playerKey, s.streak, s.lost]),
    [
      ["missed", 9, false],
      ["lost", 6, true],
    ],
  );
});

test("an aggregate streak steps over days the upstream bot never posted", async () => {
  // Days 1–6 posted, then a two-day outage, then 9 and 10. Nobody could have
  // played 7 or 8, so they cost nobody their streak.
  const posted = [1, 2, 3, 4, 5, 6, 9];
  const rows = [
    ...posted.map((d) => row("a", d, { isCrown: true })),
    row("b", 10, { isCrown: true }),
  ].map((r) => ({ ...r, puzzleId: null }));

  const day = await gameDay(CROWN_GAME, rows, new Date(tsOf(10)));
  assert.deepEqual(
    streakEnds(day).map((s) => [s.entry.playerKey, s.streak]),
    [["a", 7]],
  );
});

// --- milestones and sweeps ------------------------------------------------------

test("a first crown and every 25th are milestones", async () => {
  const rows = [
    row("new", 30, { isCrown: true }),
    ...run("vet", 1, 25, { isCrown: true }),
    ...run("mid", 1, 7, { isCrown: true }),
    row("mid", 30, { isCrown: true }),
  ];
  const day = await gameDay(POINTS_GAME, rows, postedAfter(25));
  assert.deepEqual(crownMilestones(day).map((m) => [m.entry.playerKey, m.count]), [["vet", 25]]);

  const later = await gameDay(POINTS_GAME, rows, postedAfter(30));
  assert.deepEqual(
    crownMilestones(later).map((m) => [m.entry.playerKey, m.count]),
    [["new", 1]],
  );
});

test("a sweep takes every crown on the post", async () => {
  const date = postedAfter(5);
  const points = await gameDay(POINTS_GAME, [row("a", 5, { isCrown: true })], date);
  const other = await gameDay(
    { ...POINTS_GAME, id: "other", label: "Other" },
    [row("a", 5, { isCrown: true }), row("b", 5, { isCrown: true })],
    date,
  );

  assert.deepEqual(keys(sweeps([points, other])), ["a"]);
  assert.deepEqual(sweeps([points]), [], "one game is not a sweep");
});

// --- the section ----------------------------------------------------------------

test("the podium groups ties and leaves out the unsolved", async () => {
  const rows = [
    row("a", 5, { points: 30, place: 1, isCrown: true }),
    row("b", 5, { points: 30, place: 1, isCrown: true }),
    row("c", 5, { points: 20, place: 3 }),
    row("d", 5, { points: 0, place: 4, score: null }),
  ];
  const day = await gameDay(POINTS_GAME, rows, postedAfter(5));

  assert.equal(day.title, "🅿️ Points #5");
  assert.deepEqual(
    day.podium.map((p) => [p.place, p.result, p.names]),
    [
      [1, "30 pts", ["<@a>", "<@b>"]],
      [3, "20 pts", ["<@c>"]],
    ],
  );
  assert.deepEqual(day.stats, ["4 played", "1 ❌"]);
});

test("a game nobody played that day drops out", async () => {
  assert.equal(await gameDay(POINTS_GAME, [row("a", 1)], postedAfter(5)), null);
});

// --- callouts, end to end -------------------------------------------------------

test("a dethroning on both boards is one callout naming both", async () => {
  const rows = [row("a", 1, { points: 100 }), row("b", 1, { points: 90 }), row("b", 2, { points: 20 })];
  const date = postedAfter(2);
  const day = await gameDay(POINTS_GAME, rows, date);
  const { dethrones } = dailyCallouts([day], { semester: semesterOf(date.getTime()) });

  assert.equal(dethrones.length, 1);
  assert.equal(
    dethrones[0].text,
    "<@b> knocks <@a> off the top of the all-time and Fall 2026 Points boards.",
  );
});

test("a change on only one board names only that board", async () => {
  // `a` built their lead last semester; this semester `b` has led all along.
  const summer = Date.parse("2026-07-01T16:00:00Z");
  const rows = [
    row("a", 1, { points: 500, ts: summer }),
    row("b", 1, { points: 30 }),
    row("c", 1, { points: 20 }),
    row("c", 2, { points: 20 }),
  ];
  const date = postedAfter(2);
  const day = await gameDay(POINTS_GAME, rows, date);
  const { dethrones, highlights } = dailyCallouts([day], { semester: semesterOf(date.getTime()) });

  assert.deepEqual(dethrones.map((d) => d.text), [
    "<@c> knocks <@b> off the top of the Fall 2026 Points board.",
  ]);
  assert.deepEqual(highlights, ["📈 <@c> passes <@b> for 2nd on the all-time Points board."]);
});

// --- rendering ------------------------------------------------------------------

async function sampleSummary(extraHighlights = []) {
  const rows = [row("a", 1, { points: 100 }), row("b", 1, { points: 90 }), row("b", 2, { points: 20, isCrown: true })];
  const date = postedAfter(2);
  const day = await gameDay(POINTS_GAME, rows, date);
  const callouts = dailyCallouts([day], { semester: semesterOf(date.getTime()) });
  callouts.highlights.push(...extraHighlights);
  return { heading: "📅 Daily results · Thursday 3 September", days: [day], callouts };
}

const json = (message) => message.components.map((c) => c.toJSON());

test("the summary is a silent Components V2 message", async () => {
  const message = renderDailySummary(await sampleSummary());

  assert.equal(message.flags, MessageFlags.IsComponentsV2);
  assert.deepEqual(message.allowedMentions, { parse: [] });
  assert.equal(message.content, undefined, "V2 messages cannot carry content");
});

test("a dethroning gets a gold card, with the new leader's avatar when known", async () => {
  const summary = await sampleSummary();

  const [, plain] = json(renderDailySummary(summary));
  assert.equal(plain.accent_color, 0xf1c40f);
  assert.match(plain.components[0].content, /^## 👑 Dethroned!/);

  const avatars = new Map([["b", "https://cdn.example/b.png"]]);
  const [, withAvatar] = json(renderDailySummary(summary, { avatars }));
  assert.equal(withAvatar.components[0].accessory.media.url, "https://cdn.example/b.png");
});

test("each game gets a card in its own colour", async () => {
  const cards = json(renderDailySummary(await sampleSummary()));
  const game = cards.find((c) => c.accent_color === POINTS_GAME.color);

  assert.match(game.components[0].content, /^### 🅿️ Points #2/);
  assert.match(game.components[2].content, /👑 \*\*20 pts\*\*  <@b>/);
});

test("highlights give way before the post outgrows the text cap", async () => {
  const filler = Array.from({ length: 200 }, (_, i) => `🎉 ${nameOf(row(`p${i}`, 1))} filler line`);
  const message = renderDailySummary(await sampleSummary(filler));

  const total = JSON.stringify(json(message))
    .match(/"content":"((?:[^"\\]|\\.)*)"/g)
    .map((m) => JSON.parse(m.slice(10)).length)
    .reduce((a, b) => a + b, 0);
  assert.ok(total <= TEXT_LIMIT, `${total} characters`);
  assert.match(JSON.stringify(json(message)), /📣 Highlights/);
});
