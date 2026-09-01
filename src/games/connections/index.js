import { createSelfReportStore } from "../../data/selfReportStore.js";
import { parseConnectionsResult } from "./parser.js";
import { basePoints, dailyScore } from "./score.js";
import { puzzleNumberForET } from "./summary.js";
import { bestWorstFields } from "../../utils/statFields.js";

const COLOUR_EMOJI = { yellow: "🟨", green: "🟩", blue: "🟦", purple: "🟪" };

const store = createSelfReportStore("connections", {
  basePoints,
  dailyScore,
  // `score` keeps the mistakes/null convention (null = loss) so the shared
  // store's "did they solve it" checks and the avg-mistakes stat both work.
  scoreOf: (p) => (p.solved ? p.mistakes : null),
  detailsOf: (p) => ({
    slipMistakes: p.slipMistakes,
    purpleFirst: p.purpleFirst,
    reverseRainbow: p.reverseRainbow,
    solveOrder: p.solveOrder,
  }),
  extraStats(rows) {
    let purpleFirsts = 0;
    let reverseRainbows = 0;
    for (const r of rows) {
      if (r.score === null) continue;
      const d = r.details ? JSON.parse(r.details) : {};
      if (d.purpleFirst) purpleFirsts++;
      if (d.reverseRainbow) reverseRainbows++;
    }
    return { purpleFirsts, reverseRainbows };
  },
});

export default {
  id: "connections",
  label: "Connections",
  emoji: "🟨🟩🟦🟪",
  color: 0xb19cd9,
  kind: "self-report",
  hasPoints: true,
  store,
  puzzleNumberFor: puzzleNumberForET,

  /** Players post their own grids, so any non-bot message is a candidate. */
  wantsMessage: (message) => !message.author.bot,
  parse: parseConnectionsResult,

  formatDm(parsed, score) {
    const lines = [
      parsed.solved
        ? `✅ Solved Puzzle #${parsed.puzzle}`
        : `😂🫵 You choked on Puzzle #${parsed.puzzle}! Embarrassing.`,
    ];

    if (parsed.solved) {
      const streakPart = score.streak > 1 ? ` + ${score.streak} streak` : "";
      lines.push(`**Points:** ${score.base} base${streakPart} = **${score.total}**`);
    } else {
      lines.push("**Points:** 0 (no points for a loss)");
    }

    const orderEmoji = parsed.solveOrder.map((c) => COLOUR_EMOJI[c]).join(" → ");
    lines.push(`**Solve order:** ${orderEmoji || "—"}`);

    if (parsed.mistakes > 0) {
      const slipNote =
        parsed.slipMistakes > 0 ? ` (${parsed.slipMistakes} slip 🫣)` : "";
      lines.push(`**Mistakes:** ${parsed.mistakes}${slipNote}`);
    } else {
      lines.push("**Mistakes:** none 🎯");
    }

    const specials = [];
    if (parsed.purpleFirst) specials.push("Purple First 🟪 (+15)");
    if (parsed.reverseRainbow) specials.push("Reverse Rainbow 🌈 (+30)");
    if (specials.length) lines.push(`**Specials:** ${specials.join(", ")}`);

    lines.push("", "-# To cancel DMs, please reply '*stop*'.");
    return lines.join("\n");
  },

  /** What this game's `score` counts, for axis labels. */
  scoreLabel: "mistakes",

  /**
   * What /distribution can plot. Mistakes are a small fixed range, so they bin
   * one-per-value; daily points spread across roughly 0..130 and get equal-width
   * bins instead. Both read getSeries() rows, where `points` is already the full
   * daily score.
   */
  distributionMetrics: [
    {
      id: "mistakes",
      label: "Mistakes",
      axis: "Days",
      discrete: true,
      min: 0,
      max: 4,
      valueOf: (row) => row.score,
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
  leaderboardEmpty: "No Connections results recorded yet.",
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
      // Averaged over every day played: a loss really does score 0 points, so
      // leaving those out would flatter everyone who ever choked.
      name: "📊 Avg. score",
      value: s.games ? `${s.avgPoints.toFixed(1)} pts/day` : "N/A",
      inline: true,
    },
    {
      name: "🎯 Mistakes",
      value: s.wins
        ? `avg ${s.avgScore.toFixed(2)}  ·  med ${s.medianScore.toFixed(2)}` +
          (s.stdevScore === null ? "" : `  ·  σ ${s.stdevScore.toFixed(2)}`)
        : "N/A",
      inline: true,
    },
    {
      name: "👑 Win rate",
      value: `${s.games ? ((s.wins / s.games) * 100).toFixed(1) : "0.0"}%`,
      inline: true,
    },
    {
      name: "Special",
      value: [
        `🟪  ${s.purpleFirsts}  Purple First`,
        `🌈  ${s.reverseRainbows}  Reverse Rainbow`,
      ].join("\n"),
    },
  ],

  /** Shown by /stats unless `detail:false`. More points is better. */
  detailFields: (s) =>
    bestWorstFields(s, {
      by: "meanPoints",
      direction: "higher",
      label: "avg. score",
      format: (b) => `${b.meanPoints.toFixed(1)} pts`,
    }),
};
