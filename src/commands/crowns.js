import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getCrowns } from "../data/crownStore.js";

export default {
  data: new SlashCommandBuilder()
    .setName("crowns")
    .setDescription("Show the Wordle crown leaderboard"),

  async execute(interaction) {
    const users = getCrowns();

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

    const chunks = [];
    let current = [];
    for (const line of lines) {
      const candidate = [...current, line].join("\n");
      if (candidate.length > 1024) {
        chunks.push(current);
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) chunks.push(current);

    const leaderboardFields = chunks.map((chunk, i) => ({
      name: i === 0 ? "📊 Leaderboard" : "​",
      value: chunk.join("\n"),
    }));

    const embed = new EmbedBuilder()
      .setTitle("👑 Crown Leaderboard")
      .setColor(0xffd700)
      .addFields(
        { name: "👑 Total Crowns", value: summary, inline: true },
        ...leaderboardFields
      );

    await interaction.reply({ embeds: [embed] });
  },
};
