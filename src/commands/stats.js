import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getCrowns } from '../data/crownStore.js';

function crownCount(user) {
  return (user.scores ?? []).filter(s => s.isCrown).length;
}

function currentStreak(scores) {
  if (!scores.length) return 0;
  const days = [...new Set(scores.map(s => Math.floor(s.ts / 86400000)))]
    .sort((a, b) => b - a);
  let streak = 1;
  for (let i = 1; i < days.length; i++) {
    if (days[i - 1] - days[i] === 1) streak++;
    else break;
  }
  return streak;
}

function crownRank(users, targetKey) {
  const sorted = Object.values(users)
    .map(u => crownCount(u))
    .sort((a, b) => b - a);

  const targetCount = crownCount(users[targetKey]);
  let rank = 1;
  for (const count of sorted) {
    if (count > targetCount) rank++;
    else break;
  }
  return { rank, total: sorted.length };
}

const PLACE_LABELS = ['🥇', '🥈', '🥉'];

function placeLabel(n) {
  if (n <= 3) return PLACE_LABELS[n - 1];
  const suffix = n % 10 === 1 && n % 100 !== 11 ? 'st'
    : n % 10 === 2 && n % 100 !== 12 ? 'nd'
    : n % 10 === 3 && n % 100 !== 13 ? 'rd'
    : 'th';
  return `${n}${suffix}`;
}

export default {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription("Show a player's Wordle statistics")
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The player to look up (defaults to you)')
    ),

  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    const users = getCrowns();
    const user = users[target.id];

    if (!user || !user.scores?.length) {
      await interaction.reply({ content: `No Wordle data found for ${target}.`, ephemeral: true });
      return;
    }

    const scores = user.scores;
    const crowns = crownCount(user);
    const { rank, total } = crownRank(users, target.id);
    const streak = currentStreak(scores);

    const guesses = scores.map(s => s.score).filter(s => s !== null);
    const avgGuesses = guesses.length
      ? (guesses.reduce((a, b) => a + b, 0) / guesses.length).toFixed(2)
      : 'N/A';
    const failures = scores.filter(s => s.score === null).length;

    const placeCounts = {};
    for (const s of scores) {
      placeCounts[s.place] = (placeCounts[s.place] ?? 0) + 1;
    }
    const placeLines = Object.entries(placeCounts)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([place, count]) => `${placeLabel(Number(place))}  ${count}`)
      .join('\n');

    const displayName = target.displayName ?? target.username;

    const embed = new EmbedBuilder()
      .setTitle(`📊 Stats for ${displayName}`)
      .setColor(0x5865F2)
      .addFields(
        { name: '👑 Crowns', value: `${crowns}  (rank #${rank} of ${total})`, inline: true },
        { name: '📅 Current streak', value: `${streak} day${streak === 1 ? '' : 's'}`, inline: true },
        { name: '🎯 Avg guesses', value: `${avgGuesses}${failures ? `  (${failures} failure${failures === 1 ? '' : 's'} excluded)` : ''}`, inline: true },
        { name: 'Place history', value: placeLines || 'None' },
      );

    await interaction.reply({ embeds: [embed] });
  },
};
