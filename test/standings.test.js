import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// db.js resolves its file at import time, so point it at a scratch directory
// before anything pulls it in.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sinebot-standings-"));

const {
  foldSeries,
  standings,
  champions,
  leadChanges,
  participation,
  improvement,
  nameOf,
} = await import("../src/utils/standings.js");
const { rankedLines } = await import("../src/utils/leaderboard.js");
const { GAMES, getGame } = await import("../src/games/registry.js");

// A stand-in game, so the pure folds are tested on their own terms rather than
// through whichever real game happens to rank the way the assertion wants.
const POINTS_GAME = {
  leaderboardFilter: (e) => e.games > 0,
  leaderboardRankKey: (e) => e.totalPoints,
  leaderboardLine: (rank, e) => `${rank}. ${nameOf(e)}: ${e.totalPoints}`,
  periodMetric: {
    by: "meanPoints",
    direction: "higher",
    label: "avg. score",
    format: (b) => b.meanPoints.toFixed(1),
  },
};

const ET = (day, hour = 12) => Date.parse(`2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00-04:00`);

/** One series row, in the shape both stores' getSeries() emit. */
function row(playerKey, day, { points = 100, score = 3, isCrown = false, place = 1 } = {}) {
  return {
    playerKey,
    playerType: "id",
    displayName: null,
    ts: ET(day),
    puzzleId: String(day),
    score,
    isCrown,
    place,
    points,
  };
}

test("foldSeries counts each player's days, crowns, medals and points", () => {
  const [alice] = foldSeries([
    row("alice", 1, { points: 100, isCrown: true }),
    row("alice", 2, { points: 120, place: 2 }),
    row("alice", 3, { points: 0, score: null, place: 3 }),
  ]);

  assert.equal(alice.games, 3);
  assert.equal(alice.wins, 2, "a loss carries no score");
  assert.equal(alice.totalPoints, 220);
  assert.equal(alice.crowns, 1);
  assert.equal(alice.silver, 1);
  assert.equal(alice.bronze, 1);
  assert.equal(alice.uid, "alice");
});

test("standings rank on the game's own measure", () => {
  const entries = standings(
    [row("alice", 1, { points: 100 }), row("bob", 1, { points: 300 })],
    POINTS_GAME,
  );
  assert.deepEqual(entries.map((e) => e.playerKey), ["bob", "alice"]);
});

test("everyone tied on top is a champion, and the gap skips the tie", () => {
  const entries = standings(
    [
      row("alice", 1, { points: 300 }),
      row("bob", 1, { points: 300 }),
      row("cara", 1, { points: 120 }),
    ],
    POINTS_GAME,
  );
  const { champions: winners, runnerUp, gap } = champions(entries, POINTS_GAME);

  assert.deepEqual(winners.map((e) => e.playerKey).sort(), ["alice", "bob"]);
  assert.equal(runnerUp.playerKey, "cara");
  assert.equal(gap, 180);
});

test("an uncontested board has no runner-up to measure against", () => {
  const entries = standings([row("alice", 1)], POINTS_GAME);
  assert.equal(champions(entries, POINTS_GAME).gap, null);
});

test("the lead changing hands is counted, a tie at the top is not", () => {
  // Day 1: alice ahead. Day 2: bob overtakes. Day 3: alice draws level — she
  // hasn't taken the lead back, so that is not a second change.
  const { changes, leader } = leadChanges(
    [
      row("alice", 1, { points: 200 }),
      row("bob", 1, { points: 100 }),
      row("bob", 2, { points: 300 }),
      row("alice", 3, { points: 200 }),
    ],
    POINTS_GAME,
  );

  assert.equal(changes, 1);
  assert.equal(leader, "bob");
});

test("a wire-to-wire win records no lead change", () => {
  const { changes } = leadChanges(
    [
      row("alice", 1, { points: 300 }),
      row("bob", 1, { points: 100 }),
      row("alice", 2, { points: 300 }),
      row("bob", 2, { points: 100 }),
    ],
    POINTS_GAME,
  );
  assert.equal(changes, 0);
});

test("turnout counts days anybody played, not days in the window", () => {
  // Three days were played across the server; alice missed one of them. The
  // days nobody played at all are not in anyone's denominator.
  const turnout = participation([
    row("alice", 1),
    row("bob", 1),
    row("bob", 5),
    row("alice", 9),
    row("bob", 9),
  ]);
  const by = (key) => turnout.find((p) => p.playerKey === key);
  const [alice, bob] = [by("alice"), by("bob")];

  assert.equal(turnout[0].playerKey, "bob", "busiest first");

  assert.equal(bob.days, 3);
  assert.equal(bob.of, 3);
  assert.equal(bob.rate, 1);
  assert.equal(alice.days, 2);
  assert.equal(alice.of, 3);
});

test("two results on one day are one day of turnout", () => {
  const [alice] = participation([
    { ...row("alice", 1), ts: ET(1, 9) },
    { ...row("alice", 1), ts: ET(1, 21) },
  ]);
  assert.equal(alice.days, 1);
});

test("improvement compares per-day averages, not totals", () => {
  // Bob plays twice as many days but at the same rate; alice plays fewer days
  // and improves. Compared on totals bob would win by turning up more.
  const days = [1, 2, 3, 4, 5];
  const previous = [
    ...days.map((d) => row("alice", d, { points: 100 })),
    ...days.map((d) => row("bob", d, { points: 200 })),
    ...[6, 7, 8, 9, 10].map((d) => row("bob", d, { points: 200 })),
  ];
  const current = [
    ...days.map((d) => row("alice", d, { points: 150 })),
    ...days.map((d) => row("bob", d, { points: 200 })),
  ];

  const movers = improvement(current, previous, POINTS_GAME);
  assert.equal(movers[0].playerKey, "alice");
  assert.equal(movers[0].from, 100);
  assert.equal(movers[0].to, 150);
  assert.equal(movers[0].delta, 50);
  assert.equal(movers[1].delta, 0, "bob held level");
});

test("improvement follows the direction the game says is good", () => {
  const lower = { ...POINTS_GAME, periodMetric: { ...POINTS_GAME.periodMetric, by: "meanScore", direction: "lower" } };
  const days = [1, 2, 3, 4, 5];
  const movers = improvement(
    days.map((d) => row("alice", d, { score: 3 })),
    days.map((d) => row("alice", d, { score: 5 })),
    lower,
  );
  // Five guesses down to three is an improvement, so the delta is positive.
  assert.equal(movers[0].delta, 2);
});

test("a player short of five days in either semester is not compared", () => {
  const movers = improvement(
    [1, 2, 3, 4].map((d) => row("alice", d, { points: 150 })),
    [1, 2, 3, 4, 5].map((d) => row("alice", d, { points: 100 })),
    POINTS_GAME,
  );
  assert.deepEqual(movers, []);
});

// The safety net. foldSeries rebuilds an entry shape the stores also produce;
// if a store's leaderboard entry ever changes and the fold doesn't, a semester
// board would quietly disagree with the all-time one. An unwindowed fold has to
// render byte-for-byte identically to getLeaderboard().
test("an unwindowed fold renders exactly the all-time board", async () => {
  const GUILD = "guild-invariant";

  const connections = getGame("connections");
  let msg = 0;
  const solve = (uid, puzzle, mistakes) =>
    connections.store.record(
      GUILD,
      {
        puzzle,
        solved: true,
        mistakes,
        slipMistakes: 0,
        purpleFirst: false,
        reverseRainbow: false,
        solveOrder: ["yellow", "green", "blue", "purple"],
      },
      uid,
      `c-${++msg}`,
      ET(1) + puzzle * 86_400_000,
    );

  for (const p of [1, 2, 3, 4]) {
    solve("alice", p, 0);
    solve("bob", p, p === 2 ? 0 : 2);
  }

  const wordle = getGame("wordle");
  for (const day of [1, 2, 3]) {
    wordle.store.record(
      GUILD,
      {
        scores: [
          { score: 3, isCrown: true, users: [{ type: "id", id: "alice" }] },
          { score: 5, isCrown: false, users: [{ type: "name", raw: "Luc | Design" }] },
        ],
      },
      `w-${day}`,
      ET(day),
    );
  }

  for (const game of [connections, wordle]) {
    const allTime = game.store.getLeaderboard(GUILD).filter(game.leaderboardFilter);
    const folded = standings(game.store.getSeries(GUILD), game);

    assert.deepEqual(
      rankedLines(folded, game),
      rankedLines(allTime, game),
      `${game.label}: folded board differs from getLeaderboard()`,
    );
    assert.deepEqual(
      game.leaderboardSummary(folded),
      game.leaderboardSummary(allTime),
      `${game.label}: folded summary differs`,
    );
  }
});

test("every registered game can render a folded entry", () => {
  // Catches a game whose leaderboard hooks read a field foldSeries doesn't
  // carry — it would throw or print undefined rather than fail quietly.
  const entries = foldSeries([row("alice", 1, { isCrown: true }), row("bob", 2)]);
  for (const game of GAMES) {
    for (const line of rankedLines(entries.filter(game.leaderboardFilter), game)) {
      assert.match(line, /^\d+\./, `${game.label}: unexpected line "${line}"`);
      assert.doesNotMatch(line, /undefined|NaN/, `${game.label}: "${line}"`);
    }
    assert.equal(typeof game.leaderboardRankKey(entries[0]), "number");
  }
});
