import { GAMES } from "../games/registry.js";
import { selfReportSummaryLines } from "../games/puzzleNumber.js";
import { trackedChannel } from "../data/guildConfigStore.js";
import { dmEnabled, setDmEnabledAll } from "../data/userPrefsStore.js";

export default {
  name: "messageCreate",
  once: false,
  async execute(message) {
    // A DM has no guild, so it can only be a preference reply.
    if (message.guildId === null) {
      if (!message.author.bot) await handleDmReply(message);
      return;
    }

    for (const game of GAMES) {
      if (!game.wantsMessage(message)) continue;
      if (message.channelId !== trackedChannel(message.guildId, game.id)) continue;

      const parsed = game.parse(message);
      if (!parsed) continue;

      if (game.kind === "aggregate") {
        await handleAggregate(message, game, parsed);
      } else {
        await handleSelfReport(message, game, parsed);
      }
      return; // one message belongs to at most one game
    }
  },
};

async function handleAggregate(message, game, parsed) {
  game.store.record(message.guildId, parsed, message.id, message.createdTimestamp);
  await postDailySummary(message, game, parsed);
}

async function handleSelfReport(message, game, parsed) {
  const score = game.store.record(
    message.guildId,
    parsed,
    message.author.id,
    message.id,
    message.createdTimestamp,
  );

  // null means a duplicate or a re-share of a puzzle already logged.
  if (!score || !game.formatDm) return;
  if (!dmEnabled(message.author.id, game.id)) return;

  try {
    await message.author.send(game.formatDm(parsed, score));
  } catch (err) {
    // Closed DMs are routine, not an error worth failing the handler over.
    console.warn(`[${game.id}] Failed to DM ${message.author.id}: ${err.message}`);
  }
}

/**
 * Posts one combined summary when an aggregate game fires: that game's own
 * announcement, followed by yesterday's crown for every self-report game the
 * guild tracks. Sections with nothing to report drop out.
 */
async function postDailySummary(message, announcingGame, parsed) {
  const lines = await announcingGame.announce({
    guildId: message.guildId,
    message,
    parsed,
  });

  for (const game of GAMES) {
    if (game.kind !== "self-report") continue;
    if (!trackedChannel(message.guildId, game.id)) continue;
    lines.push(...selfReportSummaryLines(game, message.guildId, message.createdAt));
  }

  if (lines.length === 0) return;
  await message.channel.send(lines.join("\n"));
}

// Lets a player mute or unmute result DMs by replying in the DM itself,
// mirroring `/settings dm`. Preferences are global, so this needs no guild.
async function handleDmReply(message) {
  const content = message.content.trim().toLowerCase();
  const ids = GAMES.map((g) => g.id);

  if (content === "stop") {
    setDmEnabledAll(message.author.id, ids, false);
    await message.channel.send("DMs stopped. Reply with 'resume' to resume DMs.");
  } else if (content === "resume") {
    setDmEnabledAll(message.author.id, ids, true);
    await message.channel.send("DMs resumed. Reply with 'stop' to cancel DMs again.");
  }
}
