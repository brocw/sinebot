import test from "node:test";
import assert from "node:assert/strict";
import { guildPeriods, MIN_PLAYS } from "../src/utils/periods.js";

// 2026-06-01 is a Monday. Built with the local constructor, as the buckets are
// local-time.
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

/** A getSeries()-shaped row — note `isCrown`, not the raw `is_crown` column. */
const row = (ts, { score = 3, points = 0, isCrown = false, playerKey = "a" } = {}) => ({
  playerKey,
  ts,
  score,
  points,
  isCrown,
});

const GUESSES = { by: "meanScore", direction: "lower" };
const POINTS = { by: "meanPoints", direction: "higher" };

/** `n` weekly repeats of one calendar day, all scoring the same. */
function weekly(day, n, attrs) {
  return Array.from({ length: n }, (_, i) => row(at(2026, 6, day + i * 7), attrs));
}

test("guildPeriods pools every player onto the same weekday", () => {
  const series = [
    ...weekly(1, 5, { score: 5, playerKey: "a" }),
    ...weekly(2, 3, { score: 2, playerKey: "a" }),
    ...weekly(2, 3, { score: 2, playerKey: "b" }),
  ];

  const { buckets, best, worst } = guildPeriods(series, {
    grouping: "weekday",
    metric: GUESSES,
  });

  // Tuesday only clears the threshold because two players' rows are pooled.
  assert.equal(buckets[1].plays, 6);
  assert.equal(best.label, "Tue");
  assert.equal(worst.label, "Mon");
});

test("guildPeriods leaves thin buckets unranked and counts them", () => {
  const series = [
    ...weekly(1, 5, { score: 5 }),
    ...weekly(2, 5, { score: 3 }),
    ...weekly(3, MIN_PLAYS.weekday - 1, { score: 1 }), // a suspiciously good Wednesday
  ];

  const { best, worst, thin } = guildPeriods(series, {
    grouping: "weekday",
    metric: GUESSES,
  });

  assert.equal(thin, 1);
  assert.equal(best.label, "Tue"); // not Wednesday, on four rows
  assert.equal(worst.label, "Mon");
});

test("guildPeriods counts empty weekdays as gaps, not thin buckets", () => {
  const { thin, buckets } = guildPeriods(weekly(1, 5, { score: 4 }), {
    grouping: "weekday",
    metric: GUESSES,
  });

  assert.equal(thin, 0);
  assert.equal(buckets[1].plays, 0);
  assert.equal(buckets[1].meanScore, null);
});

test("guildPeriods ranks points the other way up", () => {
  const series = [
    ...weekly(1, 5, { score: 1, points: 90 }),
    ...weekly(2, 5, { score: 1, points: 30 }),
  ];

  const { best, worst } = guildPeriods(series, {
    grouping: "weekday",
    metric: POINTS,
  });

  assert.equal(best.label, "Mon");
  assert.equal(worst.label, "Tue");
});

test("guildPeriods returns no best when nothing clears the threshold", () => {
  const { best, worst } = guildPeriods(weekly(1, MIN_PLAYS.weekday - 1, { score: 4 }), {
    grouping: "weekday",
    metric: GUESSES,
  });

  assert.equal(best, null);
  assert.equal(worst, null);
});

test("guildPeriods trims months to the requested window", () => {
  const series = [
    row(at(2026, 4, 10), { score: 6 }),
    row(at(2026, 5, 10), { score: 2 }),
    row(at(2026, 6, 10), { score: 4 }),
  ];

  const { buckets } = guildPeriods(series, {
    grouping: "month",
    count: 2,
    metric: GUESSES,
    minPlays: 1,
  });

  assert.deepEqual(
    buckets.map((b) => b.key),
    ["2026-05", "2026-06"],
  );
});

test("guildPeriods averages only the months on the chart", () => {
  const series = [
    row(at(2026, 4, 10), { score: 6 }), // trimmed away, and out of the average
    row(at(2026, 5, 10), { score: 2 }),
    row(at(2026, 6, 10), { score: 4 }),
  ];

  const { overall } = guildPeriods(series, {
    grouping: "month",
    count: 2,
    metric: GUESSES,
    minPlays: 1,
  });

  assert.equal(overall.plays, 2);
  assert.equal(overall.meanScore, 3);
});

test("guildPeriods holds a month to a higher bar than a weekday", () => {
  const days = (month, n, score) =>
    Array.from({ length: n }, (_, i) => row(at(2026, month, 1 + (i % 28)), { score }));

  // July has more than a weekday's worth of results and a better average, but
  // not enough to be called the server's best month.
  const series = [
    ...days(6, MIN_PLAYS.month, 4),
    ...days(7, MIN_PLAYS.weekday + 1, 1),
  ];

  const { best, thin } = guildPeriods(series, { grouping: "month", metric: GUESSES });

  assert.equal(best.key, "2026-06");
  assert.equal(thin, 1);
});

test("guildPeriods reads the crown flag off series rows", () => {
  const series = [
    row(at(2026, 6, 1), { isCrown: true }),
    row(at(2026, 6, 8), { isCrown: false }),
  ];

  const { buckets } = guildPeriods(series, {
    grouping: "weekday",
    metric: GUESSES,
  });

  assert.equal(buckets[0].crowns, 1);
});
