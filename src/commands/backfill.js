import { SlashCommandBuilder } from 'discord.js';
import { WORDLE_BOT_ID, parseWordleResult } from '../utils/wordleParser.js';
import { rebuildFromResults } from '../data/crownStore.js';

export default {
  data: new SlashCommandBuilder()
    .setName('backfill')
    .setDescription('Scan channel history and rebuild the crown database from all Wordle results'),

  async execute(interaction) {
    await interaction.deferReply();

    const channelId = process.env.WORDLE_CHANNEL_ID;
    const channel = interaction.client.channels.cache.get(channelId)
      ?? await interaction.client.channels.fetch(channelId);

    // Collect all results oldest-first so processedMessageIds are stored in
    // chronological order, then rebuild in one write.
    const pairs = [];
    let lastId = null;
    let scanned = 0;

    while (true) {
      const messages = await channel.messages.fetch({
        limit: 100,
        ...(lastId && { before: lastId }),
      });

      if (messages.size === 0) break;

      for (const [, message] of messages) {
        if (message.author.id !== WORDLE_BOT_ID) continue;
        const result = parseWordleResult(message);
        if (result) pairs.push({ result, messageId: message.id, ts: message.createdTimestamp });
      }

      scanned += messages.size;
      lastId = messages.last().id;

      if (messages.size < 100) break;
    }

    // Messages were fetched newest-first; reverse so we process oldest-first.
    pairs.reverse();

    const recorded = rebuildFromResults(pairs);

    await interaction.editReply(
      `Backfill complete. Scanned **${scanned}** messages, found **${pairs.length}** Wordle results, recorded **${recorded}** into the crown database.`
    );
  },
};
