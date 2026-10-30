import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { gameOption, gameFrom } from "../games/registry.js";
import { leaderboardFields, rankedLines } from "../utils/leaderboard.js";
import { GUILD_AND_DM, serverOption, resolveGuild } from "../utils/guildContext.js";

export default {
  data: new SlashCommandBuilder()
    .setName("crowns")
    .setDescription("Show the crown leaderboard")
    .setContexts(...GUILD_AND_DM)
    .addStringOption(gameOption)
    .addStringOption(serverOption),

  async execute(interaction) {
    const game = gameFrom(interaction);

    const context = await resolveGuild(interaction);
    if (!context) return;

    const entries = game.store
      .getLeaderboard(context.guildId)
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
