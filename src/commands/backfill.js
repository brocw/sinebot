import { SlashCommandBuilder } from "discord.js";
import { WORDLE_BOT_ID, parseWordleResult } from "../utils/wordleParser.js";
import { parseConnectionsResult } from "../utils/connectionsParser.js";
import { rebuildFromResults } from "../data/crownStore.js";
import { rebuildConnections } from "../data/connectionsStore.js";
import { GAMES, DEFAULT_GAME, gameOption } from "../utils/games.js";

/**
 * Pages through the tracked channel's full history, oldest-first, collecting
 * whatever `collect` returns for each message (null is skipped).
 */
async function scanChannel(channel, collect) {
  const collected = [];
  let lastId = null;
  let scanned = 0;

  while (true) {
    const messages = await channel.messages.fetch({
      limit: 100,
      ...(lastId && { before: lastId }),
    });
    if (messages.size === 0) break;

    for (const [, message] of messages) {
      const item = collect(message);
      if (item) collected.push(item);
    }

    scanned += messages.size;
    lastId = messages.last().id;
    if (messages.size < 100) break;
  }

  // Messages arrive newest-first; reverse so callers get chronological order.
  collected.reverse();
  return { collected, scanned };
}

export default {
  data: new SlashCommandBuilder()
    .setName("backfill")
    .setDescription(
      "Scan channel history and rebuild the score database from past results",
    )
    .addStringOption(gameOption),

  async execute(interaction) {
    await interaction.deferReply();

    const game = interaction.options.getString("game") ?? DEFAULT_GAME;
    const meta = GAMES[game];

    const channelId = process.env.WORDLE_CHANNEL_ID;
    const channel =
      interaction.client.channels.cache.get(channelId) ??
      (await interaction.client.channels.fetch(channelId));

    let scanned;
    let found;
    let recorded;

    if (game === "connections") {
      const { collected, scanned: n } = await scanChannel(channel, (message) => {
        if (message.author.bot) return null;
        const parsed = parseConnectionsResult(message);
        if (!parsed) return null;
        return {
          parsed,
          userId: message.author.id,
          messageId: message.id,
          ts: message.createdTimestamp,
        };
      });
      scanned = n;
      found = collected.length;
      recorded = rebuildConnections(interaction.guildId, collected);
    } else {
      const { collected, scanned: n } = await scanChannel(channel, (message) => {
        if (message.author.id !== WORDLE_BOT_ID) return null;
        const result = parseWordleResult(message);
        if (!result) return null;
        return {
          result,
          messageId: message.id,
          ts: message.createdTimestamp,
        };
      });
      scanned = n;
      found = collected.length;
      recorded = rebuildFromResults(interaction.guildId, "wordle", collected);
    }

    await interaction.editReply(
      `Backfill complete. Scanned **${scanned}** messages, found **${found}** ${meta.label} results, recorded **${recorded}** into the score database.`,
    );
  },
};
