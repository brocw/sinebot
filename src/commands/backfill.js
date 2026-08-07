import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} from "discord.js";
import { gameOption, gameFrom } from "../games/registry.js";
import { trackedChannel } from "../data/guildConfigStore.js";
import { requireAdmin } from "../utils/permissions.js";

/**
 * Pages through a channel's full history, oldest-first, collecting whatever
 * `collect` returns for each message (null is skipped).
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
    if (!(await requireAdmin(interaction))) return;

    const game = gameFrom(interaction);
    const channelId = trackedChannel(interaction.guildId, game.id);

    if (!channelId) {
      await interaction.reply({
        content: `${game.label} has no tracked channel here. Set one with \`/config channel game:${game.label}\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // A backfill deletes every recorded result for this game before rebuilding,
    // so make the destructive part explicit rather than implicit.
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("backfill-confirm")
        .setLabel("Wipe and rebuild")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("backfill-cancel")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );

    const prompt = await interaction.reply({
      content: `This deletes all recorded **${game.label}** results for this server and rebuilds them from <#${channelId}>. Continue?`,
      components: [confirmRow],
      flags: MessageFlags.Ephemeral,
      withResponse: true,
    });

    let choice;
    try {
      choice = await prompt.resource.message.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id,
        time: 30_000,
      });
    } catch {
      await interaction.editReply({
        content: "Backfill timed out — nothing was changed.",
        components: [],
      });
      return;
    }

    if (choice.customId === "backfill-cancel") {
      await choice.update({ content: "Backfill cancelled.", components: [] });
      return;
    }

    await choice.update({
      content: `Scanning <#${channelId}> for ${game.label} results…`,
      components: [],
    });

    const channel =
      interaction.client.channels.cache.get(channelId) ??
      (await interaction.client.channels.fetch(channelId));

    const { collected, scanned } = await scanChannel(channel, (message) => {
      if (!game.wantsMessage(message)) return null;
      const parsed = game.parse(message);
      if (!parsed) return null;
      return {
        parsed,
        userId: message.author.id,
        messageId: message.id,
        ts: message.createdTimestamp,
      };
    });

    const recorded = game.store.rebuild(interaction.guildId, collected);

    await interaction.editReply(
      `Backfill complete. Scanned **${scanned}** messages, found **${collected.length}** ${game.label} results, recorded **${recorded}** into the score database.`,
    );
  },
};
