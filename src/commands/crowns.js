import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getCrowns } from "../data/crownStore.js";
import { getConnectionsLeaderboard } from "../data/connectionsStore.js";
import { GAMES, DEFAULT_GAME, gameOption } from "../utils/games.js";

// Splits leaderboard lines into <=1024-char chunks for embed fields.
function chunkLines(lines) {
  const chunks = [];
  let current = [];
  for (const line of lines) {
    if ([...current, line].join("\n").length > 1024) {
      chunks.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function leaderboardFields(lines, heading) {
  return chunkLines(lines).map((chunk, i) => ({
    name: i === 0 ? heading : "​",
    value: chunk.join("\n"),
  }));
}

async function connectionsLeaderboard(interaction) {
  const board = getConnectionsLeaderboard(interaction.guildId).filter(
    (e) => e.wins > 0 || e.games > 0,
  );

  if (board.length === 0) {
    await interaction.reply({
      content: "No Connections results recorded yet.",
      ephemeral: true,
    });
    return;
  }

  let rank = 0;
  let prev = null;
  const lines = board.map((e) => {
    if (e.totalPoints !== prev) {
      rank += 1;
      prev = e.totalPoints;
    }
    return `${rank}. <@${e.uid}>: 🏅 ${e.totalPoints}  👑 ${e.crowns}  (${e.wins}/${e.games})`;
  });

  const embed = new EmbedBuilder()
    .setTitle("🏅 Connections Points Leaderboard")
    .setColor(0xb19cd9)
    .addFields(...leaderboardFields(lines, "📊 Leaderboard (🏅 points · 👑 crowns · wins/games)"));

  await interaction.reply({ embeds: [embed] });
}

export default {
  data: new SlashCommandBuilder()
    .setName("crowns")
    .setDescription("Show the crown leaderboard")
    .addStringOption(gameOption),

  async execute(interaction) {
    const game = interaction.options.getString("game") ?? DEFAULT_GAME;

    if (game === "connections") {
      await connectionsLeaderboard(interaction);
      return;
    }

    const meta = GAMES[game];
    const users = getCrowns(interaction.guildId, game);

    const entries = Object.entries(users)
      .map(([key, u]) => [
        key,
        u,
        (u.scores ?? []).filter((s) => s.isCrown).length,
      ])
      .filter(([, , count]) => count > 0)
      .sort(([, , a], [, , b]) => b - a);

    if (entries.length === 0) {
      await interaction.reply({
        content: "No crowns recorded yet.",
        ephemeral: true,
      });
      return;
    }

    let totalCrowns = 0,
      totalSilver = 0,
      totalBronze = 0;
    let rank = 0;
    let prevCrowns = null;
    const lines = entries.map(([key, u, count]) => {
      if (count !== prevCrowns) {
        rank += 1;
        prevCrowns = count;
      }
      const scores = u.scores ?? [];
      const second = scores.filter((s) => s.place === 2).length;
      const third = scores.filter((s) => s.place === 3).length;
      totalCrowns += count;
      totalSilver += second;
      totalBronze += third;
      const display =
        u.type === "id"
          ? `<@${key}>`
          : (u.displayName?.split("||")[0].trim() ?? key.replace("name:", ""));
      return `${rank}. ${display}: 👑 ${count}  🥈 ${second}  🥉 ${third}`;
    });

    const summary = `👑 ${totalCrowns}  🥈 ${totalSilver}  🥉 ${totalBronze}`;

    const embed = new EmbedBuilder()
      .setTitle(`👑 ${meta.label} Crown Leaderboard`)
      .setColor(0xffd700)
      .addFields(
        { name: "👑 Total Crowns", value: summary, inline: true },
        ...leaderboardFields(lines, "📊 Leaderboard"),
      );

    await interaction.reply({ embeds: [embed] });
  },
};
