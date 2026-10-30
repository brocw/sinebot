import { GAMES } from "../games/registry.js";
import { buildDailySummary, renderDailySummary } from "../summary/index.js";
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
 * Posts one combined summary when an aggregate game fires: yesterday in that
 * game, followed by yesterday in every self-report game the guild tracks, and
 * whatever the day did to the leaderboards. Games nobody played drop out.
 */
async function postDailySummary(message, announcingGame, parsed) {
  const games = [
    announcingGame,
    ...GAMES.filter(
      (g) =>
        g.kind === "self-report" &&
        g.puzzleNumberFor &&
        trackedChannel(message.guildId, g.id),
    ),
  ];

  const summary = await buildDailySummary({
    guildId: message.guildId,
    date: message.createdAt,
    games,
    parsed: new Map([[announcingGame.id, parsed]]),
  });
  if (!summary) return;

  const avatars = await dethronedAvatars(message.client, summary);
  await message.channel.send(renderDailySummary(summary, { avatars }));
}

// Each dethroning card carries the new leader's avatar. Decoration only: a
// failed lookup leaves that card without one.
async function dethronedAvatars(client, summary) {
  const avatars = new Map();
  for (const { who } of summary.callouts.dethrones) {
    const [entry] = who;
    if (entry.playerType !== "id" || avatars.has(entry.playerKey)) continue;
    try {
      const user = await client.users.fetch(entry.playerKey);
      avatars.set(entry.playerKey, user.displayAvatarURL({ extension: "png", size: 128 }));
    } catch (err) {
      console.warn(`[summary] No avatar for ${entry.playerKey}: ${err.message}`);
    }
  }
  return avatars;
}

// Lets a player mute or unmute result DMs by replying in the DM itself,
// mirroring `/config dm`. Preferences are global, so this needs no guild.
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
