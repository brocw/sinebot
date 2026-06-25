import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getCrowns } from "../data/crownStore.js";
import { getConnectionsStats } from "../data/connectionsStore.js";
import { GAMES, DEFAULT_GAME, gameOption } from "../utils/games.js";

function crownCount(user) {
  return (user.scores ?? []).filter((s) => s.isCrown).length;
}

function currentStreak(scores) {
  if (!scores.length) return 0;
  const days = [
    ...new Set(scores.map((s) => Math.floor(s.ts / 86400000))),
  ].sort((a, b) => b - a);
  let streak = 1;
  for (let i = 1; i < days.length; i++) {
    if (days[i - 1] - days[i] === 1) streak++;
    else break;
  }
  return streak;
}

function crownRank(users, targetKey) {
  const sorted = Object.values(users)
    .map((u) => crownCount(u))
    .sort((a, b) => b - a);

  const targetCount = crownCount(users[targetKey]);
  let rank = 1;
  for (const count of sorted) {
    if (count > targetCount) rank++;
    else break;
  }
  return { rank, total: sorted.length };
}

const PLACE_LABELS = ["👑", "🥈", "🥉"];

function placeLabel(n) {
  if (n <= 3) return PLACE_LABELS[n - 1];
  const suffix =
    n % 10 === 1 && n % 100 !== 11
      ? "st"
      : n % 10 === 2 && n % 100 !== 12
        ? "nd"
        : n % 10 === 3 && n % 100 !== 13
          ? "rd"
          : "th";
  return `${n}${suffix}`;
}

export default {
  data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show a player's game statistics")
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("The player to look up (defaults to you)"),
    )
    .addStringOption(gameOption),

  async execute(interaction) {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const game = interaction.options.getString("game") ?? DEFAULT_GAME;
    const meta = GAMES[game];

    if (game === "connections") {
      await connectionsStats(interaction, target);
      return;
    }

    const users = getCrowns(interaction.guildId, game);
    const user = users[target.id];

    if (!user || !user.scores?.length) {
      await interaction.reply({
        content: `No ${meta.label} data found for ${target}.`,
        ephemeral: true,
      });
      return;
    }

    const scores = user.scores;
    const crowns = crownCount(user);
    const { rank, total } = crownRank(users, target.id);
    const streak = currentStreak(scores);

    const guesses = scores.map((s) => s.score).filter((s) => s !== null);
    const avgGuesses = guesses.length
      ? (guesses.reduce((a, b) => a + b, 0) / guesses.length).toFixed(2)
      : "N/A";
    const failures = scores.filter((s) => s.score === null).length;

    const placeCounts = {};
    for (const s of scores) {
      placeCounts[s.place] = (placeCounts[s.place] ?? 0) + 1;
    }
    const placeLines = Object.entries(placeCounts)
      .filter(([place]) => Number(place) <= 3)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([place, count]) => `${placeLabel(Number(place))}  ${count}`)
      .join("\n");

    const displayName = target.displayName ?? target.username;

    const embed = new EmbedBuilder()
      .setTitle(`📊 ${meta.label} stats for ${displayName}`)
      .setColor(0x5865f2)
      .addFields(
        {
          name: "👑 Crowns",
          value: `${crowns} (#${rank} of ${total})`,
          inline: true,
        },
        { name: "📆 Days played", value: `${scores.length}`, inline: true },
        {
          name: "📅 Current streak",
          value: `${streak} day${streak === 1 ? "" : "s"}`,
          inline: true,
        },
        {
          name: meta.avgLabel,
          value: `${avgGuesses}${failures ? `  (${failures} failure${failures === 1 ? "" : "s"} excluded)` : ""}`,
          inline: true,
        },
        {
          name: "👑 Win rate",
          value: `${((crowns / scores.length) * 100).toFixed(1)}%`,
          inline: true,
        },
        { name: "Medals", value: placeLines || "None" },
      );

    await interaction.reply({ embeds: [embed] });
  },
};

async function connectionsStats(interaction, target) {
  const s = getConnectionsStats(interaction.guildId, target.id);

  if (!s) {
    await interaction.reply({
      content: `No Connections data found for ${target}.`,
      ephemeral: true,
    });
    return;
  }

  const displayName = target.displayName ?? target.username;
  const winRate = s.games ? ((s.wins / s.games) * 100).toFixed(1) : "0.0";

  const embed = new EmbedBuilder()
    .setTitle(`🟨🟩🟦🟪 Connections stats for ${displayName}`)
    .setColor(0xb19cd9)
    .addFields(
      { name: "🏅 Total points", value: `${s.totalPoints}`, inline: true },
      { name: "👑 Crowns", value: `${s.crowns}`, inline: true },
      {
        name: "Games (Wins)",
        value: `${s.games} (${s.wins}, ${winRate}%)`,
        inline: true,
      },
      {
        name: "📅 Current streak",
        value: `${s.currentStreak} day${s.currentStreak === 1 ? "" : "s"}`,
        inline: true,
      },
      {
        name: "🎯 Avg. mistakes",
        value: s.wins ? s.avgMistakes.toFixed(2) : "N/A",
        inline: true,
      },
      {
        name: "🟪 Purple First",
        value: `${s.purpleFirsts}`,
        inline: true,
      },
      {
        name: "🌈 Reverse Rainbows",
        value: `${s.reverseRainbows}`,
        inline: true,
      },
    );

  await interaction.reply({ embeds: [embed] });
}
