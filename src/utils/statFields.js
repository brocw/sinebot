import { bestWorst } from "./stats.js";

// Renders the best/worst breakdown from a store's timeBreakdown() buckets into
// embed fields. Shared by every game, because the layout should be identical;
// what differs is only which field is ranked and which end of it is good, and
// both come in as arguments.

const MIN_PLAYS = 3;

function line(marker, bucket, format) {
  return `${marker} **${bucket.label}** — ${format(bucket)} · ${bucket.plays} play${
    bucket.plays === 1 ? "" : "s"
  }`;
}

function field(name, buckets, opts) {
  const { best, worst } = bestWorst(buckets, { ...opts, minPlays: MIN_PLAYS });

  if (!best) {
    return {
      name,
      value: `Not enough data yet — needs ${MIN_PLAYS}+ plays in a bucket.`,
      inline: true,
    };
  }

  // One qualifying bucket is its own best and worst, which reads as noise.
  const value =
    best.key === worst.key
      ? line("▪️", best, opts.format)
      : [line("🔼", best, opts.format), line("🔽", worst, opts.format)].join("\n");

  return { name, value, inline: true };
}

/**
 * Best and worst weekday and month for a player.
 *
 * @param {{ byWeekday: object[], byMonth: object[] }} stats  from getStats()
 * @param {{
 *   by: string,                        // bucket field to rank on, e.g. "meanScore"
 *   direction: "higher" | "lower",     // which end is good
 *   format: (bucket) => string,        // renders the ranked value
 *   label: string,                     // what the value is, e.g. "avg. guesses"
 * }} opts
 * @returns {object[]} embed fields
 */
export function bestWorstFields(stats, { by, direction, format, label }) {
  return [
    field(`📅 Best & worst day · ${label}`, stats.byWeekday, {
      by,
      direction,
      format,
    }),
    field(`🗓️ Best & worst month · ${label}`, stats.byMonth, {
      by,
      direction,
      format,
    }),
  ];
}
