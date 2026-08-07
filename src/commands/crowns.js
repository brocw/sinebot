import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { gameOption, gameFrom } from "../games/registry.js";
import { leaderboardFields, rankedLines } from "../utils/leaderboard.js";

export default {
  data: new SlashCommandBuilder()
    .setName("crowns")
    .setDescription("Show the crown leaderboard")
    .addStringOption(gameOption),

  async execute(interaction) {
    const game = gameFrom(interaction);
    const entries = game.store
      .getLeaderboard(interaction.guildId)
      .filter(game.leaderboardFilter);

    if (entries.length === 0) {
      await interaction.reply({
        content: game.leaderboardEmpty,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`${game.emoji} ${game.label} ${game.leaderboardTitle}`)
      .setColor(game.color)
      .addFields(
        { ...game.leaderboardSummary(entries), inline: true },
        ...leaderboardFields(rankedLines(entries, game), "📊 Leaderboard"),
      );

    await interaction.reply({ embeds: [embed] });
  },
};
