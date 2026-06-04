import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getCrowns } from '../data/crownStore.js';

export default {
  data: new SlashCommandBuilder()
    .setName('crowns')
    .setDescription('Show the Wordle crown leaderboard'),

  async execute(interaction) {
    const users = getCrowns();

    const entries = Object.entries(users)
      .map(([key, u]) => [key, u, (u.scores ?? []).filter(s => s.isCrown).length])
      .filter(([, , count]) => count > 0)
      .sort(([, , a], [, , b]) => b - a);

    if (entries.length === 0) {
      await interaction.reply({ content: 'No crowns recorded yet.', ephemeral: true });
      return;
    }

    let rank = 0;
    let prevCrowns = null;
    const lines = entries.map(([key, u, count]) => {
      if (count !== prevCrowns) {
        rank += 1;
        prevCrowns = count;
      }
      const display = u.type === 'id'
        ? `<@${key}>`
        : (u.displayName?.split('||')[0].trim() ?? key.replace('name:', ''));
      return `${rank}. ${display} — **${count}** 👑`;
    });

    const embed = new EmbedBuilder()
      .setTitle('👑 Crown Leaderboard')
      .setDescription(lines.join('\n'))
      .setColor(0xFFD700);

    await interaction.reply({ embeds: [embed] });
  },
};
