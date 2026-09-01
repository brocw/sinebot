import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// db.js resolves its file at import time, so point it at a scratch directory
// before anything pulls it in.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sinebot-test-"));

const { createSelfReportStore } = await import("../src/data/selfReportStore.js");

// A deliberately plain game, so these tests exercise the shared store rather
// than Connections' scoring rules.
const store = createSelfReportStore("testgame", {
  basePoints: (p) => (p.solved ? 100 : 0),
  dailyScore: (base, streak) => (base > 0 ? base + streak : 0),
  scoreOf: (p) => (p.solved ? (p.mistakes ?? 0) : null),
  detailsOf: () => ({}),
});

let guildSeq = 0;
const newGuild = () => `guild-${++guildSeq}`;

let msgSeq = 0;
function post(guild, user, puzzle, { solved = true, mistakes = 0 } = {}) {
  return store.record(
    guild,
    { puzzle, solved, mistakes },
    user,
    `msg-${++msgSeq}`,
    1_700_000_000_000 + puzzle * 86_400_000,
  );
}

const crownUids = (guild, puzzle) =>
  store
    .getPuzzleCrowns(guild, String(puzzle))
    .crowns.map((c) => c.uid)
    .sort();

test("a solo solver takes the crown", () => {
  const g = newGuild();
  post(g, "alice", 10);
  assert.deepEqual(crownUids(g, 10), ["alice"]);
});

test("streak bonus decides the crown between equal solves", () => {
  const g = newGuild();
  // Alice has a three-day streak going into puzzle 3; Bob only two.
  post(g, "alice", 1);
  post(g, "alice", 2);
  post(g, "bob", 2);
  post(g, "alice", 3);
  post(g, "bob", 3);

  assert.deepEqual(crownUids(g, 3), ["alice"]);
  const { crowns } = store.getPuzzleCrowns(g, "3");
  assert.equal(crowns[0].score, 103, "100 base + 3 streak");
});

test("a late submission restandardises every later puzzle", () => {
  const g = newGuild();
  post(g, "alice", 1);
  post(g, "alice", 2);
  post(g, "bob", 2);
  post(g, "alice", 3);
  post(g, "bob", 3);
  assert.deepEqual(crownUids(g, 3), ["alice"], "precondition: alice leads");

  // Bob back-fills puzzle 1. That extends his streak through puzzles 2 and 3,
  // which were already ranked — those days must be recomputed, not left stale.
  post(g, "bob", 1);

  assert.deepEqual(crownUids(g, 3), ["alice", "bob"], "puzzle 3 re-ranked");
  assert.deepEqual(crownUids(g, 2), ["alice", "bob"], "puzzle 2 re-ranked");
});

test("a loss earns no crown and breaks the streak", () => {
  const g = newGuild();
  post(g, "alice", 1);
  post(g, "alice", 2, { solved: false });

  assert.deepEqual(crownUids(g, 2), [], "nobody solved it");
  assert.equal(store.getStats(g, "alice").currentStreak, 0);
});

test("nobody is crowned on a puzzle everyone failed", () => {
  const g = newGuild();
  post(g, "alice", 5, { solved: false });
  post(g, "bob", 5, { solved: false });
  assert.deepEqual(crownUids(g, 5), []);
});

test("ties share the crown and the place", () => {
  const g = newGuild();
  post(g, "alice", 7);
  post(g, "bob", 7);
  assert.deepEqual(crownUids(g, 7), ["alice", "bob"]);
});

test("a re-share of the same puzzle is ignored", () => {
  const g = newGuild();
  assert.ok(post(g, "alice", 20));
  assert.equal(post(g, "alice", 20), null, "second post returns null");
  assert.equal(store.getStats(g, "alice").games, 1);
});

test("a duplicate message id is ignored", () => {
  const g = newGuild();
  const parsed = { puzzle: 30, solved: true, mistakes: 0 };
  assert.ok(store.record(g, parsed, "alice", "dupe", 1));
  assert.equal(store.record(g, parsed, "alice", "dupe", 1), null);
});

test("stats aggregate points, wins and streak", () => {
  const g = newGuild();
  post(g, "alice", 1);
  post(g, "alice", 2, { mistakes: 2 });
  post(g, "alice", 3, { solved: false });
  post(g, "alice", 4);

  const s = store.getStats(g, "alice");
  assert.equal(s.games, 4);
  assert.equal(s.wins, 3);
  assert.equal(s.currentStreak, 1, "puzzle 3 was a loss, so only puzzle 4 counts");
  assert.equal(s.avgScore, 2 / 3, "mistakes averaged over solves only");
  // puzzle 1 (101) + puzzle 2 (102) + puzzle 4 (101)
  assert.equal(s.totalPoints, 304);
});

test("stats average points over every day played, losses included", () => {
  const g = newGuild();
  post(g, "alice", 1);
  post(g, "alice", 2, { mistakes: 2 });
  post(g, "alice", 3, { solved: false });
  post(g, "alice", 4);

  const s = store.getStats(g, "alice");
  // 304 points across 4 days played — the loss counts as the 0 it scored.
  assert.equal(s.avgPoints, 76);
});

test("stats report median and spread over solved days only", () => {
  const g = newGuild();
  post(g, "alice", 1); // 0 mistakes
  post(g, "alice", 2, { mistakes: 2 });
  post(g, "alice", 3, { solved: false }); // no score at all
  post(g, "alice", 4); // 0 mistakes

  const s = store.getStats(g, "alice");
  assert.equal(s.medianScore, 0, "median of [0, 2, 0]");
  // Sample deviation of [0, 2, 0]: mean 2/3, ss 8/3, /2, square rooted.
  assert.ok(Math.abs(s.stdevScore - Math.sqrt(4 / 3)) < 1e-9);
});

test("median and spread are null when nothing was ever solved", () => {
  const g = newGuild();
  post(g, "alice", 1, { solved: false });

  const s = store.getStats(g, "alice");
  assert.equal(s.medianScore, null);
  assert.equal(s.stdevScore, null);
  assert.equal(s.avgScore, 0);
});

test("stats break results down by weekday and month", () => {
  const g = newGuild();
  // Local-time constructor, because the buckets are local-time too.
  const at = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
  const solve = (puzzle, mistakes, ts) =>
    store.record(g, { puzzle, solved: true, mistakes }, "alice", `bd-${puzzle}`, ts);

  solve(101, 1, at(2026, 6, 1)); // Monday
  solve(108, 3, at(2026, 6, 8)); // Monday
  solve(102, 2, at(2026, 6, 2)); // Tuesday

  const s = store.getStats(g, "alice");

  const [mon, tue, wed] = s.byWeekday;
  assert.equal(mon.plays, 2);
  assert.equal(mon.meanScore, 2, "mistakes across the two Mondays");
  assert.equal(mon.meanPoints, 101, "100 base + a one-day streak, both Mondays");
  assert.equal(tue.plays, 1);
  assert.equal(wed.plays, 0);

  assert.equal(s.byMonth.length, 1);
  assert.equal(s.byMonth[0].key, "2026-06");
  assert.equal(s.byMonth[0].plays, 3);
});

test("getStats returns null for a player with no results", () => {
  assert.equal(store.getStats(newGuild(), "nobody"), null);
});

test("leaderboard ranks by total points", () => {
  const g = newGuild();
  post(g, "alice", 1);
  post(g, "alice", 2);
  post(g, "bob", 2);

  const board = store.getLeaderboard(g);
  assert.deepEqual(board.map((e) => e.uid), ["alice", "bob"]);
  // puzzle 1 at streak 1 (101) + puzzle 2 at streak 2 (102)
  assert.equal(board[0].totalPoints, 203);
  assert.equal(board[0].crowns, 2);
  assert.equal(board[1].totalPoints, 101, "bob's lone solve carries a 1-day streak");
});

test("guilds are isolated from one another", () => {
  const a = newGuild();
  const b = newGuild();
  post(a, "alice", 50);
  assert.equal(store.getStats(b, "alice"), null);
  assert.deepEqual(crownUids(b, 50), []);
});

test("rebuild replaces history and settles every puzzle once", () => {
  const g = newGuild();
  post(g, "alice", 1);
  post(g, "bob", 1);

  const entries = [1, 2, 3].flatMap((puzzle) => [
    {
      parsed: { puzzle, solved: true, mistakes: 0 },
      userId: "bob",
      messageId: `rb-b-${puzzle}`,
      ts: puzzle * 1000,
    },
  ]);
  const recorded = store.rebuild(g, entries);

  assert.equal(recorded, 3);
  assert.equal(store.getStats(g, "alice"), null, "old history cleared");
  assert.deepEqual(crownUids(g, 3), ["bob"]);
  assert.equal(store.getStats(g, "bob").currentStreak, 3);
});

test("getSeries returns one entry per result with full daily scores", () => {
  const g = newGuild();
  post(g, "alice", 1);
  post(g, "alice", 2);

  const series = store.getSeries(g);
  assert.equal(series.length, 2);
  assert.deepEqual(series.map((r) => r.points), [101, 102]);
  assert.ok(series.every((r) => r.playerKey === "alice" && r.playerType === "id"));
});
