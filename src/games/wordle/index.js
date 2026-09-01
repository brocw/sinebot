import { createAggregateStore, displayFromRaw } from "../../data/aggregateStore.js";
import { WORDLE_BOT_ID, parseWordleResult } from "./parser.js";
import { fetchDailyWord, assessCommonality } from "./daily.js";
import { joinNames, makePuzzleNumbering } from "../puzzleNumber.js";
import { placeLabel } from "../../utils/leaderboard.js";
import { bestWorstFields } from "../../utils/statFields.js";

const store = createAggregateStore("wordle");

const LABEL = "Wordle";
const EMOJI = "🟩🟨⬛";

/**
 * The upstream message carries no puzzle number, so it is derived from the date
 * — the numbering NYT's own endpoint calls `days_since_launch`, where launch
 * day (19 June 2021, US Eastern) is 0. Checked against that endpoint: 31 Aug
 * 2026 is 1899 and 1 Sep 2026 is 1900.
 */
const puzzleNumberFor = makePuzzleNumbering({
  anchorUTC: Date.UTC(2021, 5, 19),
  anchorNumber: 0,
});

export default {
  id: "wordle",
  label: LABEL,
  emoji: EMOJI,
  color: 0xffd700,
  kind: "aggregate",
  hasPoints: false,
  store,

  /** Results arrive only from the upstream Wordle bot. */
  wantsMessage: (message) => message.author.id === WORDLE_BOT_ID,
  parse: parseWordleResult,

  /**
   * Exposed for the same reason self-report games expose it — so the puzzle can
   * be named without an upstream message. Declaring it does not enrol Wordle in
   * the daily self-report summary; that path is self-report only.
   */
  puzzleNumberFor,

  /**
   * The Wordle bot's post is the day's anchor event, so this game announces:
   * yesterday's word plus who took the crown. Other games append their own
   * summary lines to the same message.
   *
   * @returns {Promise<string[]>}
   */
  async announce({ message, parsed }) {
    const crownEntry = parsed.scores.find((s) => s.isCrown);
    if (!crownEntry) return [];

    // The bot posts the morning after, so its results — and the word below —
    // are yesterday's. The same `- 1` every self-report summary applies.
    const puzzle = puzzleNumberFor(message.createdAt) - 1;
    const lines = [`${EMOJI} ${LABEL} #${puzzle}`];

    const yesterday = new Date(message.createdAt);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const word = await fetchDailyWord(yesterday);
    if (word) {
      const commonality = await assessCommonality(word);
      lines.push(
        commonality
          ? `📖 Yesterday's word: **${word}**, ${commonality}.`
          : `📖 Yesterday's word: **${word}**.`,
      );
    }

    const scoreStr = crownEntry.score !== null ? `${crownEntry.score}/6` : "X/6";
    const names = crownEntry.users.map((u) =>
      u.type === "id" ? `<@${u.id}>` : displayFromRaw(u.raw, ""),
    );
    const verb = crownEntry.users.length === 1 ? "takes" : "share";
    lines.push(`👑 ${joinNames(names)} ${verb} the ${LABEL} crown with **${scoreStr}**!`);

    return lines;
  },

  /** What this game's `score` counts, for axis labels. */
  scoreLabel: "guesses",

  /**
   * What /distribution can plot. Read off getSeries() rows, so no store change
   * is needed to add one. Wordle scores are guesses over a fixed 1..6 range, so
   * the bins are the values themselves and the range is declared rather than
   * inferred — a week with no 6/6 should still show an empty 6 bar.
   */
  distributionMetrics: [
    {
      id: "guesses",
      label: "Guesses",
      axis: "Days",
      discrete: true,
      min: 1,
      max: 6,
      valueOf: (row) => row.score,
    },
  ],

  leaderboardTitle: "Crown Leaderboard",
  leaderboardFilter: (e) => e.crowns > 0,
  leaderboardEmpty: "No crowns recorded yet.",
  leaderboardLine: (rank, e) => {
    const display = e.playerType === "id" ? `<@${e.playerKey}>` : e.displayName;
    return `${rank}. ${display}: 👑 ${e.crowns}  🥈 ${e.silver}  🥉 ${e.bronze}`;
  },
  leaderboardRankKey: (e) => e.crowns,
  leaderboardSummary(entries) {
    const sum = (f) => entries.reduce((a, e) => a + f(e), 0);
    return {
      name: "👑 Total Crowns",
      value: `👑 ${sum((e) => e.crowns)}  🥈 ${sum((e) => e.silver)}  🥉 ${sum((e) => e.bronze)}`,
    };
  },

  statFields: (s) => [
    {
      name: "👑 Crowns",
      value: `${s.crowns} (#${s.rank} of ${s.contenders})`,
      inline: true,
    },
    { name: "📆 Days played", value: `${s.games}`, inline: true },
    {
      name: "📅 Current streak",
      value: `${s.currentStreak} day${s.currentStreak === 1 ? "" : "s"}`,
      inline: true,
    },
    {
      name: "🎯 Guesses",
      value: s.wins
        ? [
            `avg ${s.avgScore.toFixed(2)}  ·  med ${s.medianScore.toFixed(2)}` +
              (s.stdevScore === null ? "" : `  ·  σ ${s.stdevScore.toFixed(2)}`),
            s.failures
              ? `${s.failures} failure${s.failures === 1 ? "" : "s"} excluded`
              : null,
          ]
            .filter(Boolean)
            .join("\n")
        : "N/A",
      inline: true,
    },
    {
      name: "👑 Win rate",
      value: `${s.games ? ((s.crowns / s.games) * 100).toFixed(1) : "0.0"}%`,
      inline: true,
    },
    {
      name: "Medals",
      value:
        Object.entries(s.placeCounts)
          .filter(([place]) => Number(place) <= 3)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([place, count]) => `${placeLabel(Number(place))}  ${count}`)
          .join("\n") || "None",
    },
  ],

  /** Shown by /stats unless `detail:false`. Fewer guesses is better. */
  detailFields: (s) =>
    bestWorstFields(s, {
      by: "meanScore",
      direction: "lower",
      label: "avg. guesses",
      format: (b) => b.meanScore.toFixed(2),
    }),
};
