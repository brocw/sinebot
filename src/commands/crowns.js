import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getCrowns } from '../data/crownStore.js';

export default {
  data: new SlashCommandBuilder()
    .setName('crowns')
    .setDescription('Show the Wordle crown leaderboard'),

  async execute(interaction) {
    const users = getCrowns();

    const entries = Object.entries(users)
      .filter(([, u]) => u.crowns > 0)
      .sort(([, a], [, b]) => b.crowns - a.crowns);

    if (entries.length === 0) {
      await interaction.reply({ content: 'No crowns recorded yet.', ephemeral: true });
      return;
    }

    let rank = 0;
    let prevCrowns = null;
    const lines = entries.map(([key, u]) => {
      if (u.crowns !== prevCrowns) {
        rank += 1;
        prevCrowns = u.crowns;
      }
      const display = u.type === 'id'
        ? `<@${key}>`
        : (u.displayName?.split('||')[0].trim() ?? key.replace('name:', ''));
      return `${rank}. ${display} — **${u.crowns}** 👑`;
    });

    const embed = new EmbedBuilder()
      .setTitle('👑 Crown Leaderboard')
      .setDescription(lines.join('\n'))
      .setColor(0xFFD700);

    await interaction.reply({ embeds: [embed] });
  },
};
