import { parseMessage } from "../utils/messageParser.js";
import { WORDLE_BOT_ID, parseWordleResult } from "../utils/wordleParser.js";
import { recordResult } from "../data/crownStore.js";
import { fetchDailyWord, assessCommonality } from "../utils/wordleDaily.js";

export default {
  name: "messageCreate",
  once: false,
  async execute(message) {
    if (message.author.id === WORDLE_BOT_ID) {
      if (message.channelId !== process.env.WORDLE_CHANNEL_ID) return;
      const result = parseWordleResult(message);
      if (!result) return;
      recordResult(result, message.id, message.createdTimestamp);
      await postDailySummary(message, result);
      return;
    }

    if (message.author.bot) return;

    parseMessage(message);
  },
};

function formatCrownUsers(users) {
  const names = users.map((u) =>
    u.type === "id" ? `<@${u.id}>` : u.raw.split("||")[0].trim(),
  );
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

async function postDailySummary(message, result) {
  const crownEntry = result.scores.find((s) => s.isCrown);
  if (!crownEntry) return;

  const yesterday = new Date(message.createdAt);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const word = await fetchDailyWord(yesterday);
  const commonality = word ? await assessCommonality(word) : null;

  const lines = [];

  if (word) {
    lines.push(
      commonality
        ? `📖 Yesterday's word: **${word}** — ${commonality}.`
        : `📖 Yesterday's word: **${word}**.`,
    );
  }

  const scoreStr = crownEntry.score !== null ? `${crownEntry.score}/6` : "X/6";
  const crownUsers = formatCrownUsers(crownEntry.users);
  const verb = crownEntry.users.length === 1 ? "takes" : "share";
  lines.push(`👑 ${crownUsers} ${verb} the crown with **${scoreStr}**!`);

  await message.channel.send(lines.join("\n"));
}
