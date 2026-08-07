import { createAggregateStore, displayFromRaw } from "../../data/aggregateStore.js";
import { WORDLE_BOT_ID, parseWordleResult } from "./parser.js";
import { fetchDailyWord, assessCommonality } from "./daily.js";
import { joinNames } from "../puzzleNumber.js";
import { placeLabel } from "../../utils/leaderboard.js";

const store = createAggregateStore("wordle");

export default {
  id: "wordle",
  label: "Wordle",
  emoji: "🟩🟨⬛",
  color: 0xffd700,
  kind: "aggregate",
  hasPoints: false,
  store,

  /** Results arrive only from the upstream Wordle bot. */
  wantsMessage: (message) => message.author.id === WORDLE_BOT_ID,
  parse: parseWordleResult,

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

    const lines = [];

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
    lines.push(`👑 ${joinNames(names)} ${verb} the Wordle crown with **${scoreStr}**!`);

    return lines;
  },

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
      name: "🎯 Avg. guesses",
      value: s.wins
        ? `${s.avgScore.toFixed(2)}${s.failures ? `  (${s.failures} failure${s.failures === 1 ? "" : "s"} excluded)` : ""}`
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
};
