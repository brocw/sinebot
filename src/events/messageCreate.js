import { parseMessage } from "../utils/messageParser.js";
import { WORDLE_BOT_ID, parseWordleResult } from "../utils/wordleParser.js";
import { parseConnectionsResult } from "../utils/connectionsParser.js";
import { recordResult } from "../data/crownStore.js";
import { recordConnectionsResult } from "../data/connectionsStore.js";
import { getConnectionsDm } from "../data/userSettingsStore.js";
import { connectionsSummaryLines } from "../connectionsSummary.js";
import { fetchDailyWord, assessCommonality } from "../utils/wordleDaily.js";

export default {
  name: "messageCreate",
  once: false,
  async execute(message) {
    if (message.author.id === WORDLE_BOT_ID) {
      if (message.channelId !== process.env.WORDLE_CHANNEL_ID) return;
      const result = parseWordleResult(message);
      if (!result) return;
      recordResult(
        message.guildId,
        "wordle",
        result,
        message.id,
        message.createdTimestamp,
      );
      await postDailySummary(message, result);
      return;
    }

    if (message.author.bot) return;

    // Connections results are self-posted by players in the same tracked channel.
    if (message.channelId === process.env.WORDLE_CHANNEL_ID) {
      const connections = parseConnectionsResult(message);
      if (connections) {
        const score = recordConnectionsResult(
          message.guildId,
          connections,
          message.author.id,
          message.id,
          message.createdTimestamp,
        );
        if (score && getConnectionsDm(message.guildId, message.author.id)) {
          try {
            await message.author.send(
              formatConnectionsReply(connections, score),
            );
          } catch (err) {
            console.warn(
              `[connections] Failed to DM ${message.author.id}: ${err.message}`,
            );
          }
        }
        return;
      }
    }

    parseMessage(message);
  },
};

const COLOUR_EMOJI = { yellow: "🟨", green: "🟩", blue: "🟦", purple: "🟪" };

function formatConnectionsReply(parsed, score) {
  const header = parsed.solved
    ? `✅ Solved Puzzle #${parsed.puzzle}`
    : `❌ Failed Puzzle #${parsed.puzzle}`;

  const lines = [header];

  if (parsed.solved) {
    const streakPart = score.streak > 1 ? ` + ${score.streak} streak` : "";
    lines.push(
      `**Points:** ${score.base} base${streakPart} = **${score.total}**`,
    );
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

  return `${lines.join("\n")}`;
}

function formatCrownUsers(users) {
  const names = users.map((u) =>
    u.type === "id" ? `<@${u.id}>` : u.raw.split("||")[0].trim(),
  );
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

// Posts a single combined daily summary when the Wordle bot drops its results:
// the Wordle word + crown, followed by yesterday's Connections crown (pulled
// from the database). Either section is omitted if it has no crown to report.
async function postDailySummary(message, result) {
  const lines = [];

  const crownEntry = result.scores.find((s) => s.isCrown);
  if (crownEntry) {
    const yesterday = new Date(message.createdAt);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const word = await fetchDailyWord(yesterday);
    const commonality = word ? await assessCommonality(word) : null;

    if (word) {
      lines.push(
        commonality
          ? `📖 Yesterday's word: **${word}**, ${commonality}.`
          : `📖 Yesterday's word: **${word}**.`,
      );
    }

    const scoreStr =
      crownEntry.score !== null ? `${crownEntry.score}/6` : "X/6";
    const crownUsers = formatCrownUsers(crownEntry.users);
    const verb = crownEntry.users.length === 1 ? "takes" : "share";
    lines.push(
      `👑 ${crownUsers} ${verb} the Wordle crown with **${scoreStr}**!`,
    );
  }

  lines.push(...connectionsSummaryLines(message.guildId, message.createdAt));

  if (lines.length === 0) return;
  await message.channel.send(lines.join("\n"));
}
