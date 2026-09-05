import { createSelfReportStore } from "../../data/selfReportStore.js";
import { parseMinuteCrypticResult } from "./parser.js";
import { basePoints, dailyScore } from "./score.js";
import { puzzleNumberForET, formatPuzzleDate } from "./puzzle.js";
import { bestWorstFields } from "../../utils/statFields.js";
import { mean, median } from "../../utils/stats.js";

/** "1 hint", "0 hints". */
function hintCount(n) {
  return `${n} hint${n === 1 ? "" : "s"}`;
}

/** 🏆 beat the par, 🤝 met it, 🏋 didn't — the share's own three markers. */
function parEmoji(delta) {
  if (delta === null) return "❔";
  if (delta > 0) return "🏆";
  return delta === 0 ? "🤝" : "🏋";
}

/** How the day went against the par, as the second half of "you ...". */
function parPhrase(delta) {
  if (delta === 0) return "matched it";
  return `${delta > 0 ? "beat" : "missed"} it by ${hintCount(Math.abs(delta))}`;
}

/** "1.40 under par/day" — spelled out, because either side of par is likely. */
function avgParPhrase(delta) {
  if (delta === null) return "N/A";
  if (delta === 0) return "level with par";
  return `${Math.abs(delta).toFixed(2)} ${delta > 0 ? "under" : "over"} par/day`;
}

/** Seconds as "6m 12s", or "45s" under a minute. */
function duration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

/**
 * How a bucket of results is ranked when picking best and worst periods. One
 * definition, two readers: `/stats` ranks one player's weekdays and months on
 * it, `/periods` ranks the whole guild's on the same terms.
 *
 * Ranked on points rather than on the headline hint count, because hints are
 * not comparable between days: a Saturday that averages five hints may be a
 * Saturday of hard puzzles rather than a bad day for the player. Points are
 * scored against each day's community par, so they already carry that
 * adjustment, and more of them is better.
 */
const PERIOD_METRIC = {
  by: "meanPoints",
  direction: "higher",
  label: "avg. score",
  axis: "Average points per player-day",
  format: (b) => `${b.meanPoints.toFixed(1)} pts`,
};

const store = createSelfReportStore("minute-cryptic", {
  basePoints,
  dailyScore,
  // Hints are the score. There is no null case: the puzzle cannot be lost, so
  // every recorded day is a solved day and the store's "did they solve it"
  // checks are all satisfied — which makes a streak here a run of consecutive
  // days *played*, exactly what the game's own streak counts.
  scoreOf: (p) => p.hints,
  detailsOf: (p) => ({
    par: p.par,
    parDelta: p.parDelta,
    solvers: p.solvers,
    seconds: p.seconds,
    clue: p.clue,
    enumeration: p.enumeration,
  }),
  extraStats(rows) {
    let cleanSolves = 0;
    let underPar = 0;
    let matchedPar = 0;
    let overPar = 0;
    const deltas = [];
    const times = [];

    for (const r of rows) {
      if (r.score === 0) cleanSolves++;
      const d = r.details ? JSON.parse(r.details) : {};
      // A share without a par clause is counted as a day played and nothing
      // else — it has no side of par to fall on.
      if (typeof d.parDelta === "number") {
        deltas.push(d.parDelta);
        if (d.parDelta > 0) underPar++;
        else if (d.parDelta < 0) overPar++;
        else matchedPar++;
      }
      if (typeof d.seconds === "number") times.push(d.seconds);
    }

    return {
      cleanSolves,
      underPar,
      matchedPar,
      overPar,
      avgParDelta: mean(deltas),
      medianSeconds: median(times),
      timedDays: times.length,
    };
  },
});

export default {
  id: "minute-cryptic",
  label: "Minute Cryptic",
  // The share's own pips: hints taken are white then yellow, untouched is purple.
  emoji: "⚪️🟡🟣",
  color: 0x6d28d9,
  kind: "self-report",
  hasPoints: true,
  store,
  puzzleNumberFor: puzzleNumberForET,

  /** Players post their own shares, so any non-bot message is a candidate. */
  wantsMessage: (message) => !message.author.bot,
  parse: parseMinuteCrypticResult,

  /**
   * The puzzle number is this bot's invention (see `puzzle.js`), so it is never
   * shown — the date it stands for is what the player pasted and what the site
   * calls the puzzle.
   */
  puzzleLabel: (puzzleId) => `— ${formatPuzzleDate(puzzleId)}`,

  formatDm(parsed, score) {
    const lines = [
      `${parEmoji(parsed.parDelta)} Solved **${formatPuzzleDate(parsed.puzzle)}** with ${hintCount(parsed.hints)}`,
    ];

    // Every day played carries a streak of at least 1, so unlike Connections
    // there is no streak-free case in which to hide the second term.
    lines.push(
      `**Points:** ${score.base} base + ${score.streak} streak = **${score.total}**`,
    );

    lines.push(
      parsed.par === null
        ? "**Community par:** not reported for this puzzle"
        : `**Community par:** ${hintCount(parsed.par)} — you ${parPhrase(parsed.parDelta)}`,
    );

    if (parsed.clue) {
      const enumeration = parsed.enumeration ? ` (${parsed.enumeration})` : "";
      lines.push(`**Clue:** "${parsed.clue}"${enumeration}`);
    }
    if (parsed.seconds !== null) lines.push(`**Time:** ${duration(parsed.seconds)}`);

    lines.push("", "-# To cancel DMs, please reply '*stop*'.");
    return lines.join("\n");
  },

  /** What this game's `score` counts, for axis labels. */
  scoreLabel: "hints",

  /**
   * What /distribution can plot. Hints are small integers and bin one per
   * value, but with no declared ceiling: unlike Wordle's six guesses the game
   * has no fixed cap, so the range follows the data. Par delta is the same
   * shape either side of zero, and daily points spread wide enough to want
   * equal-width bins.
   */
  distributionMetrics: [
    {
      id: "hints",
      label: "Hints",
      axis: "Days",
      discrete: true,
      min: 0,
      valueOf: (row) => row.score,
    },
    {
      id: "par-delta",
      label: "Hints vs. par",
      axis: "Days",
      discrete: true,
      valueOf: (row) => row.details?.parDelta,
    },
    {
      id: "points",
      label: "Daily points",
      axis: "Days",
      bins: 12,
      valueOf: (row) => row.points,
    },
  ],

  leaderboardTitle: "Points Leaderboard",
  leaderboardFilter: (e) => e.games > 0,
  leaderboardEmpty: "No Minute Cryptic results recorded yet.",
  leaderboardLine: (rank, e) =>
    `${rank}. <@${e.uid}>: 🏅 ${e.totalPoints}  👑 ${e.crowns}`,
  leaderboardRankKey: (e) => e.totalPoints,
  leaderboardSummary(entries) {
    const points = entries.reduce((a, e) => a + e.totalPoints, 0);
    const crowns = entries.reduce((a, e) => a + e.crowns, 0);
    return { name: "🏅👑 Total Points & Crowns", value: `🏅 ${points}  👑 ${crowns}` };
  },

  statFields: (s) => [
    {
      name: "🏅👑 Points & Crowns",
      value: `🏅 ${s.totalPoints}  👑 ${s.crowns}`,
      inline: true,
    },
    { name: "📆 Days played", value: `${s.games}`, inline: true },
    {
      name: "📅 Current streak",
      value: `${s.currentStreak} day${s.currentStreak === 1 ? "" : "s"}`,
      inline: true,
    },
    {
      name: "📊 Avg. score",
      value: s.games ? `${s.avgPoints.toFixed(1)} pts/day` : "N/A",
      inline: true,
    },
    {
      name: "💡 Hints",
      value: s.games
        ? `avg ${s.avgScore.toFixed(2)}  ·  med ${s.medianScore.toFixed(2)}` +
          (s.stdevScore === null ? "" : `  ·  σ ${s.stdevScore.toFixed(2)}`)
        : "N/A",
      inline: true,
    },
    {
      // The headline number for this game: hints are only meaningful next to
      // what everyone else needed that day.
      name: "⚖️ Against par",
      value: avgParPhrase(s.avgParDelta),
      inline: true,
    },
    {
      name: "Special",
      value: [
        `🎯  ${s.cleanSolves}  solved with no hints`,
        `🏆 ${s.underPar} under  ·  🤝 ${s.matchedPar} matched  ·  🏋 ${s.overPar} over`,
        ...(s.medianSeconds === null
          ? []
          : [`⏱️  median ${duration(Math.round(s.medianSeconds))} over ${s.timedDays} timed day${s.timedDays === 1 ? "" : "s"}`]),
      ].join("\n"),
    },
  ],

  /** Ranks best/worst buckets for /stats and /periods alike. */
  periodMetric: PERIOD_METRIC,

  /** Shown by /stats unless `detail:false`. */
  detailFields: (s) => bestWorstFields(s, PERIOD_METRIC),
};
