import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { gameOption, gameFrom } from "../games/registry.js";

export default {
  data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show a player's game statistics")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("The player to look up (defaults to you)"),
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

    const displayName = target.displayName ?? target.username;
    const embed = new EmbedBuilder()
      .setTitle(`${game.emoji} ${game.label} stats for ${displayName}`)
      .setColor(game.color)
      .addFields(...game.statFields(stats));

    await interaction.reply({ embeds: [embed] });
  },
};
