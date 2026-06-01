import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { linkAlias } from '../data/crownStore.js';

export default {
  data: new SlashCommandBuilder()
    .setName('link-user')
    .setDescription('Map an unresolved Wordle name to a Discord user and merge their crowns')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Name as it appears in Wordle results (e.g. "Chloe G" or "Chloe G || President")')
        .setRequired(true)
    )
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The Discord user this name belongs to')
        .setRequired(true)
    ),

  async execute(interaction) {
    const raw = interaction.options.getString('name', true);
    const target = interaction.options.getUser('user', true);

    const { nk, mergedCrowns } = linkAlias(raw, target.id);

    const mergeNote = mergedCrowns > 0
      ? `Merged **${mergedCrowns}** existing crown${mergedCrowns === 1 ? '' : 's'} into their account.`
      : 'No existing crowns to merge.';

    await interaction.reply({
      content: `Linked \`${nk}\` → <@${target.id}>. ${mergeNote}\nFuture results for this name will be attributed to <@${target.id}> automatically. Run \`/backfill\` to reprocess history with the new mapping.`,
      ephemeral: true,
    });
  },
};
