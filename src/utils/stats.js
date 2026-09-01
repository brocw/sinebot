// Descriptive statistics and curve fitting. Pure functions over plain numbers —
// no database, no Discord, no Chart.js — so every figure the bot reports can be
// checked in a unit test without standing anything up.
//
// Empty or degenerate inputs return null rather than 0. A standard deviation of
// zero is a real answer (everyone scored the same); "no answer" is not, and
// collapsing the two hides missing data behind a plausible-looking number.

/** Arithmetic mean, or null for an empty list. */
export function mean(xs) {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Middle value; the mean of the middle two when the count is even. */
export function median(xs) {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Sample standard deviation (n-1). Null below two values, where spread is
 * undefined rather than zero.
 */
export function stdev(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  const ss = xs.reduce((a, x) => a + (x - m) ** 2, 0);
  return Math.sqrt(ss / (xs.length - 1));
}

/**
 * Least-squares fit of y = slope*x + intercept.
 *
 * @param {{x: number, y: number}[]} points
 * @returns {{ slope: number, intercept: number, r2: number } | null}
 *   null when there are fewer than two points, or when every x is identical
 *   (a vertical line has no slope to report).
 */
export function linearRegression(points) {
  if (points.length < 2) return null;

  const n = points.length;
  const mx = mean(points.map((p) => p.x));
  const my = mean(points.map((p) => p.y));

  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
  }
  if (sxx === 0) return null;

  const slope = sxy / sxx;
  const intercept = my - slope * mx;

  // R² as the share of variance explained. A perfectly flat y is fit exactly by
  // a zero-slope line, so that counts as R² = 1 rather than 0/0.
  let ssRes = 0;
  let ssTot = 0;
  for (const p of points) {
    ssRes += (p.y - (slope * p.x + intercept)) ** 2;
    ssTot += (p.y - my) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { slope, intercept, r2, n };
}

/**
 * Pearson correlation coefficient between two equal-length series.
 * Null when either series is constant — no correlation is defined.
 */
export function pearson(xs, ys) {
  if (xs.length !== ys.length || xs.length < 2) return null;

  const mx = mean(xs);
  const my = mean(ys);

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;

  return sxy / Math.sqrt(sxx * syy);
}

/**
 * Buckets values for a histogram.
 *
 * Two modes, because the metrics come in two shapes. Wordle guesses are
 * integers over a known 1..6 range and want one bar per value; Connections
 * daily points are effectively continuous and want equal-width bins.
 *
 * @param {number[]} values
 * @param {{ discrete?: boolean, min?: number, max?: number, bins?: number }} opts
 * @returns {{ lo: number, hi: number, mid: number, count: number, label: string }[]}
 */
export function histogram(values, opts = {}) {
  const { discrete = false, bins = 10 } = opts;

  if (discrete) {
    // A declared range keeps empty tails visible — a 6/6 bar of zero says
    // something, and dropping it would silently rescale the axis.
    const lo = opts.min ?? Math.min(...values);
    const hi = opts.max ?? Math.max(...values);
    const out = [];
    for (let v = lo; v <= hi; v++) {
      out.push({
        lo: v,
        hi: v,
        mid: v,
        count: values.filter((x) => x === v).length,
        label: String(v),
      });
    }
    return out;
  }

  if (values.length === 0) return [];

  const lo = opts.min ?? Math.min(...values);
  const hi = opts.max ?? Math.max(...values);

  // Every value identical: one bin holding all of them, rather than a zero-width
  // range that would divide by zero below.
  if (hi === lo) {
    return [
      { lo, hi, mid: lo, count: values.length, label: String(Math.round(lo)) },
    ];
  }

  const width = (hi - lo) / bins;
  const out = [];
  for (let i = 0; i < bins; i++) {
    const binLo = lo + i * width;
    const binHi = binLo + width;
    // The last bin is closed on the right so the maximum value lands somewhere.
    const last = i === bins - 1;
    out.push({
      lo: binLo,
      hi: binHi,
      mid: binLo + width / 2,
      count: values.filter((x) => x >= binLo && (last ? x <= binHi : x < binHi))
        .length,
      label: `${Math.round(binLo)}–${Math.round(binHi)}`,
    });
  }
  return out;
}

/** Normal probability density at x. Zero width means no curve to draw. */
export function normalPdf(x, mu, sigma) {
  if (!sigma || sigma <= 0) return 0;
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Groups result rows by weekday and by calendar month.
 *
 * Shared by both stores so "best day" means the same thing for every game.
 * Deliberately does not decide which end is best: fewer Wordle guesses is good,
 * more Connections points is good, so the caller supplies the direction.
 *
 * Buckets use the process's local time zone, matching how /graph builds its
 * weekly and monthly buckets. Accessors default to the column names both stores
 * already select.
 *
 * @param {object[]} rows
 * @param {{ tsOf?, scoreOf?, pointsOf?, crownOf? }} spec
 * @returns {{ byWeekday: object[], byMonth: object[] }}
 *   Buckets carry { key, label, plays, crowns, meanScore, meanPoints }.
 *   All seven weekdays are always present; only months with plays appear.
 */
export function timeBreakdown(rows, spec = {}) {
  const {
    tsOf = (r) => r.ts,
    scoreOf = (r) => r.score,
    pointsOf = (r) => r.points,
    crownOf = (r) => r.is_crown === 1,
  } = spec;

  const weekdays = WEEKDAYS.map((label, key) => blank(key, label));
  const months = new Map();

  for (const row of rows) {
    const d = new Date(tsOf(row));

    // Date#getDay is Sunday-first; shift so weeks start on Monday, as /graph does.
    add(weekdays[(d.getDay() + 6) % 7], row);

    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    let bucket = months.get(key);
    if (!bucket) {
      bucket = blank(
        key,
        d.toLocaleString("en-US", { month: "short", year: "2-digit" }),
      );
      months.set(key, bucket);
    }
    add(bucket, row);
  }

  function blank(key, label) {
    return { key, label, plays: 0, crowns: 0, scores: [], points: [] };
  }

  function add(bucket, row) {
    bucket.plays++;
    if (crownOf(row)) bucket.crowns++;
    const score = scoreOf(row);
    // A loss carries no score, so it is left out of the mean rather than
    // counted as zero — the same rule getStats already applies to avgScore.
    if (score !== null && score !== undefined) bucket.scores.push(score);
    const points = pointsOf(row);
    if (typeof points === "number") bucket.points.push(points);
  }

  const finish = ({ key, label, plays, crowns, scores, points }) => ({
    key,
    label,
    plays,
    crowns,
    meanScore: mean(scores),
    meanPoints: mean(points),
  });

  return {
    byWeekday: weekdays.map(finish),
    byMonth: [...months.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(finish),
  };
}

/**
 * Picks the highest- and lowest-scoring buckets from a timeBreakdown().
 *
 * @param {object[]} buckets
 * @param {{ by: string, direction?: "higher"|"lower", minPlays?: number }} opts
 *   `by` names the bucket field to rank on; `direction` says which end is
 *   "best". `minPlays` drops thin buckets so one lucky Tuesday can't win.
 * @returns {{ best: object|null, worst: object|null }}
 */
export function bestWorst(buckets, { by, direction = "higher", minPlays = 3 }) {
  const eligible = buckets.filter(
    (b) => b.plays >= minPlays && b[by] !== null && b[by] !== undefined,
  );
  if (eligible.length === 0) return { best: null, worst: null };

  const ascending = [...eligible].sort((a, b) => a[by] - b[by]);
  const lowest = ascending[0];
  const highest = ascending.at(-1);

  return direction === "lower"
    ? { best: lowest, worst: highest }
    : { best: highest, worst: lowest };
}
