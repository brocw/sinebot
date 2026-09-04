import { timeBreakdown, bestWorst, monthKey } from "./stats.js";

// The guild-wide half of the best/worst breakdown. `/stats` answers "which day
// is *your* day" from one player's rows; this answers "which day is the
// server's day" from everybody's, pooled, so the buckets are the same buckets
// and "best" still means whatever that game says it means.
//
// Pure: rows in, buckets out. The command on top of it only chooses colours.

/**
 * Player-days a pooled bucket needs before it is allowed to be the best or the
 * worst, per grouping.
 *
 * Both are floors, not sufficiency tests, and they differ because the buckets
 * are not the same size. A weekday collects one day in seven from the whole
 * server, so it fills up quickly; the threshold there only has to beat the
 * per-player one in `statFields`, since results are pooled across players.
 *
 * A month collects thirty days, and the month in progress is always on the chart —
 * without a much higher floor, a month two days old would take the crown off a
 * complete one on a handful of results.
 */
export const MIN_PLAYS = { weekday: 5, month: 20 };

/**
 * Pooled weekday or month buckets for one guild, ranked on the game's own
 * measure.
 *
 * @param {object[]} series  every player's rows, from store.getSeries()
 * @param {{
 *   grouping: "weekday" | "month",
 *   count?: number,                       // months to keep; ignored for weekdays
 *   metric: { by: string, direction: "higher" | "lower" },
 *   minPlays?: number,                    // defaults to this grouping's floor
 * }} opts
 * @returns {{
 *   buckets: object[],    // oldest first, or Monday first
 *   overall: object,      // the same window pooled into one bucket
 *   best: object|null,
 *   worst: object|null,
 *   thin: number,         // drawn buckets too thin to rank
 * }}
 */
export function guildPeriods(
  series,
  { grouping = "weekday", count = 12, metric, minPlays = MIN_PLAYS[grouping] } = {},
) {
  // Series rows name the crown flag differently from the raw result columns
  // timeBreakdown defaults to; everything else lines up.
  const spec = { crownOf: (r) => r.isCrown };

  let buckets;
  let overall;

  if (grouping === "weekday") {
    ({ byWeekday: buckets, overall } = timeBreakdown(series, spec));
  } else {
    // Narrow to the last `count` months of *rows*, then re-bucket, so `overall`
    // describes the window on the chart rather than all history behind it.
    const { byMonth } = timeBreakdown(series, spec);
    const window = new Set(byMonth.slice(-count).map((b) => b.key));
    const rows = series.filter((r) => window.has(monthKey(r.ts)));
    ({ byMonth: buckets, overall } = timeBreakdown(rows, spec));
  }

  const { best, worst } = bestWorst(buckets, { ...metric, minPlays });

  // A bucket with no plays at all is a gap, not a thin sample — a Wednesday
  // nobody has ever played is worth saying nothing about.
  const thin = buckets.filter(
    (b) => b.plays > 0 && b.plays < minPlays && b[metric.by] !== null,
  ).length;

  return { buckets, overall, best, worst, thin };
}
