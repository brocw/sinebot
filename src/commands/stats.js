import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { gameOption, gameFrom } from "../games/registry.js";

export default {
  data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show a player's game statistics")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("The player to look up (defaults to you)"),
    )
    .addBooleanOption((opt) =>
      opt
        .setName("detail")
        .setDescription("Add the best/worst day and month breakdown"),
    )
    .addStringOption(gameOption),

  async execute(interaction) {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const game = gameFrom(interaction);

    const stats = game.store.getStats(interaction.guildId, target.id);
    if (!stats) {
      await interaction.reply({
        content: `No ${game.label} data found for ${target}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // The breakdown is a chunk of extra fields, so it stays behind a flag
    // rather than pushing the default embed past a glanceable length.
    const detail = interaction.options.getBoolean("detail") ?? false;
    const fields = [...game.statFields(stats)];
    if (detail && game.detailFields) fields.push(...game.detailFields(stats));

    const displayName = target.displayName ?? target.username;
    const embed = new EmbedBuilder()
      .setTitle(`${game.emoji} ${game.label} stats for ${displayName}`)
      .setColor(game.color)
      .addFields(...fields);

    await interaction.reply({ embeds: [embed] });
  },
};
