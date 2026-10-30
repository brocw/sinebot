import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { gameOption, gameFrom } from "../games/registry.js";
import { GUILD_AND_DM, serverOption, resolveGuild } from "../utils/guildContext.js";

export default {
  data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show a player's game statistics")
    .setContexts(...GUILD_AND_DM)
    .addUserOption((opt) =>
      opt.setName("user").setDescription("The player to look up (default: you)"),
    )
    .addBooleanOption((opt) =>
      opt
        .setName("detail")
        .setDescription("Best/worst weekday and month, ignoring buckets under 3 plays (default: on)"),
    )
    .addStringOption(gameOption)
    .addStringOption(serverOption),

  async execute(interaction) {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const game = gameFrom(interaction);

    const context = await resolveGuild(interaction);
    if (!context) return;

    const stats = game.store.getStats(context.guildId, target.id);
    if (!stats) {
      await interaction.reply({
        content: `No ${game.label} data found for ${target}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // On by default: the breakdown is the interesting half of the embed, and
    // asking for it every time was friction. `detail:false` trims back to the
    // headline fields.
    const detail = interaction.options.getBoolean("detail") ?? true;
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
