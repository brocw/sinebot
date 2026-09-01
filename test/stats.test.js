import test from "node:test";
import assert from "node:assert/strict";
import {
  mean,
  median,
  stdev,
  linearRegression,
  pearson,
  histogram,
  normalPdf,
  timeBreakdown,
  bestWorst,
} from "../src/utils/stats.js";

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) < eps,
    `expected ${actual} to be within ${eps} of ${expected}`,
  );

test("mean and median are null for an empty list", () => {
  assert.equal(mean([]), null);
  assert.equal(median([]), null);
});

test("median takes the middle of an odd list", () => {
  assert.equal(median([5, 1, 3]), 3);
});

test("median averages the middle two of an even list", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test("median does not mutate its input", () => {
  const xs = [3, 1, 2];
  median(xs);
  assert.deepEqual(xs, [3, 1, 2]);
});

test("stdev matches a hand-computed sample deviation", () => {
  // mean 5; deviations -3,-1,1,3 => ss 20; n-1 = 3
  close(stdev([2, 4, 6, 8]), Math.sqrt(20 / 3));
});

test("stdev is zero when every value is identical", () => {
  assert.equal(stdev([4, 4, 4]), 0);
});

test("stdev is null below two values", () => {
  assert.equal(stdev([7]), null);
  assert.equal(stdev([]), null);
});

test("linearRegression recovers a known line exactly", () => {
  // y = 3x + 2
  const points = [0, 1, 2, 3, 4].map((x) => ({ x, y: 3 * x + 2 }));
  const fit = linearRegression(points);
  close(fit.slope, 3);
  close(fit.intercept, 2);
  close(fit.r2, 1);
});

test("linearRegression reports a negative slope for a falling series", () => {
  const fit = linearRegression([
    { x: 0, y: 10 },
    { x: 1, y: 8 },
    { x: 2, y: 6 },
  ]);
  close(fit.slope, -2);
});

test("linearRegression treats a flat series as perfectly explained", () => {
  const fit = linearRegression([
    { x: 0, y: 5 },
    { x: 1, y: 5 },
    { x: 2, y: 5 },
  ]);
  close(fit.slope, 0);
  close(fit.r2, 1);
});

test("linearRegression is null without two distinct x values", () => {
  assert.equal(linearRegression([{ x: 1, y: 1 }]), null);
  assert.equal(
    linearRegression([
      { x: 1, y: 1 },
      { x: 1, y: 9 },
    ]),
    null,
  );
});

test("pearson is +1, -1 and 0 for the obvious cases", () => {
  close(pearson([1, 2, 3], [2, 4, 6]), 1);
  close(pearson([1, 2, 3], [6, 4, 2]), -1);
  close(pearson([1, 2, 3, 4], [1, 3, 2, 4]), 0.8);
});

test("pearson is null when a series is constant or lengths differ", () => {
  assert.equal(pearson([1, 1, 1], [1, 2, 3]), null);
  assert.equal(pearson([1, 2], [1, 2, 3]), null);
});

test("discrete histogram keeps empty bins across the declared range", () => {
  const bins = histogram([1, 3, 3, 4], { discrete: true, min: 1, max: 6 });
  assert.equal(bins.length, 6);
  assert.deepEqual(
    bins.map((b) => b.count),
    [1, 0, 2, 1, 0, 0],
  );
  assert.deepEqual(
    bins.map((b) => b.label),
    ["1", "2", "3", "4", "5", "6"],
  );
});

test("binned histogram splits the range into equal widths", () => {
  const bins = histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { bins: 2 });
  assert.equal(bins.length, 2);
  close(bins[0].lo, 0);
  close(bins[0].hi, 5);
  close(bins[1].hi, 10);
  // Every value lands in exactly one bin.
  assert.equal(
    bins.reduce((a, b) => a + b.count, 0),
    11,
  );
});

test("binned histogram closes the last bin so the maximum is counted", () => {
  const bins = histogram([1, 5], { bins: 2 });
  assert.equal(bins.at(-1).count, 1);
});

test("binned histogram collapses to one bin when all values match", () => {
  const bins = histogram([7, 7, 7], { bins: 5 });
  assert.equal(bins.length, 1);
  assert.equal(bins[0].count, 3);
});

test("normalPdf peaks at the mean and is zero without spread", () => {
  close(normalPdf(0, 0, 1), 1 / Math.sqrt(2 * Math.PI));
  assert.ok(normalPdf(1, 0, 1) < normalPdf(0, 0, 1));
  assert.equal(normalPdf(0, 0, 0), 0);
});

// 2026-06-01 is a Monday; 2026-06-02 a Tuesday. Constructed with the local
// constructor so the buckets, which are local-time, land where the test says.
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

test("timeBreakdown always returns all seven weekdays, Monday first", () => {
  const { byWeekday } = timeBreakdown([]);
  assert.equal(byWeekday.length, 7);
  assert.deepEqual(
    byWeekday.map((b) => b.label),
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  );
  assert.equal(byWeekday[0].plays, 0);
  assert.equal(byWeekday[0].meanScore, null);
});

test("timeBreakdown bins rows onto the right weekday", () => {
  const { byWeekday } = timeBreakdown([
    { ts: at(2026, 6, 1), score: 3, points: 100, is_crown: 1 },
    { ts: at(2026, 6, 8), score: 5, points: 80, is_crown: 0 },
    { ts: at(2026, 6, 2), score: 4, points: 90, is_crown: 0 },
  ]);

  const mon = byWeekday[0];
  assert.equal(mon.plays, 2);
  assert.equal(mon.crowns, 1);
  assert.equal(mon.meanScore, 4);
  assert.equal(mon.meanPoints, 90);

  assert.equal(byWeekday[1].plays, 1);
  assert.equal(byWeekday[2].plays, 0);
});

test("timeBreakdown separates months across a boundary and sorts them", () => {
  const { byMonth } = timeBreakdown([
    { ts: at(2026, 7, 1), score: 2, points: 100, is_crown: 0 },
    { ts: at(2026, 5, 31), score: 6, points: 40, is_crown: 0 },
    { ts: at(2026, 6, 30), score: 4, points: 70, is_crown: 0 },
  ]);

  assert.deepEqual(
    byMonth.map((b) => b.key),
    ["2026-05", "2026-06", "2026-07"],
  );
  assert.equal(byMonth[0].label, "May 26");
  assert.equal(byMonth[2].meanScore, 2);
});

test("timeBreakdown excludes losses from the score mean but counts the play", () => {
  const { byWeekday } = timeBreakdown([
    { ts: at(2026, 6, 1), score: 4, points: 100, is_crown: 0 },
    { ts: at(2026, 6, 8), score: null, points: 0, is_crown: 0 },
  ]);

  const mon = byWeekday[0];
  assert.equal(mon.plays, 2);
  assert.equal(mon.meanScore, 4); // the loss is not averaged in as a zero
  assert.equal(mon.meanPoints, 50); // but it does count as zero points
});

test("timeBreakdown accepts custom accessors", () => {
  const { byWeekday } = timeBreakdown([{ when: at(2026, 6, 1), total: 12 }], {
    tsOf: (r) => r.when,
    scoreOf: () => null,
    pointsOf: (r) => r.total,
    crownOf: () => false,
  });
  assert.equal(byWeekday[0].meanPoints, 12);
});

const bucket = (label, plays, meanScore) => ({
  key: label,
  label,
  plays,
  crowns: 0,
  meanScore,
  meanPoints: null,
});

test("bestWorst reads 'lower is better' for guess-style metrics", () => {
  const { best, worst } = bestWorst(
    [bucket("Mon", 5, 3.1), bucket("Tue", 5, 4.8), bucket("Wed", 5, 4.0)],
    { by: "meanScore", direction: "lower" },
  );
  assert.equal(best.label, "Mon");
  assert.equal(worst.label, "Tue");
});

test("bestWorst reads 'higher is better' for point-style metrics", () => {
  const { best, worst } = bestWorst(
    [bucket("Mon", 5, 10), bucket("Tue", 5, 90)],
    { by: "meanScore", direction: "higher" },
  );
  assert.equal(best.label, "Tue");
  assert.equal(worst.label, "Mon");
});

test("bestWorst ignores buckets below the play threshold", () => {
  const { best } = bestWorst(
    [bucket("Mon", 1, 1.0), bucket("Tue", 9, 4.0)],
    { by: "meanScore", direction: "lower", minPlays: 3 },
  );
  assert.equal(best.label, "Tue");
});

test("bestWorst returns nulls when nothing qualifies", () => {
  const { best, worst } = bestWorst([bucket("Mon", 1, 2)], {
    by: "meanScore",
    minPlays: 3,
  });
  assert.equal(best, null);
  assert.equal(worst, null);
});
