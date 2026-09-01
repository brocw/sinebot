import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { gameOption, gameFrom } from "../games/registry.js";

export default {
  data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show a player's game statistics")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("The player to look up (default: you)"),
    )
    .addBooleanOption((opt) =>
      opt
        .setName("detail")
        .setDescription("Best/worst weekday and month, ignoring buckets under 3 plays (default: on)"),
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
