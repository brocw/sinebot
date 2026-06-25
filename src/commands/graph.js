import { SlashCommandBuilder, AttachmentBuilder } from "discord.js";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { getCrowns } from "../data/crownStore.js";
import { GAMES, DEFAULT_GAME, gameOption } from "../utils/games.js";

const COLORS = [
  "#FF6384",
  "#36A2EB",
  "#FFCE56",
  "#4BC0C0",
  "#9966FF",
  "#FF9F40",
  "#E7E9ED",
  "#7BC8A4",
  "#F4A460",
  "#DDA0DD",
];

async function resolveLabel(key, user, guild) {
  if (user.type === "name") {
    return user.displayName?.split("||")[0].trim() ?? key.replace("name:", "");
  }
  try {
    const member = await guild.members.fetch(key);
    return member.displayName;
  } catch {
    return `User …${key.slice(-4)}`;
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName("graph")
    .setDescription("Show a chart of crown wins over time")
    .addIntegerOption((opt) =>
      opt
        .setName("months")
        .setDescription("Number of months to display (default: 12)")
        .setMinValue(1)
        .setMaxValue(24),
    )
    .addStringOption(gameOption),

  async execute(interaction) {
    await interaction.deferReply();

    const monthCount = interaction.options.getInteger("months") ?? 12;
    const game = interaction.options.getString("game") ?? DEFAULT_GAME;
    const meta = GAMES[game];
    const users = getCrowns(interaction.guildId, game);

    // Build ordered month buckets covering the window
    const now = new Date();
    const months = Array.from({ length: monthCount }, (_, i) => {
      const d = new Date(
        now.getFullYear(),
        now.getMonth() - (monthCount - 1 - i),
        1,
      );
      return {
        label: d.toLocaleString("en-US", { month: "short", year: "2-digit" }),
        year: d.getFullYear(),
        month: d.getMonth(),
      };
    });

    // Build one dataset per user, skip users with no history in the window
    const datasets = [];
    let colorIdx = 0;

    for (const [key, user] of Object.entries(users)) {
      const crownScores = (user.scores ?? []).filter((s) => s.isCrown);
      if (!crownScores.length) continue;

      const data = months.map(
        ({ year, month }) =>
          crownScores.filter(({ ts }) => {
            const d = new Date(ts);
            return d.getFullYear() === year && d.getMonth() === month;
          }).length,
      );

      if (data.every((v) => v === 0)) continue;

      const label = await resolveLabel(key, user, interaction.guild);
      datasets.push({
        label,
        data,
        backgroundColor: COLORS[colorIdx % COLORS.length],
      });
      colorIdx++;
    }

    if (datasets.length === 0) {
      await interaction.editReply(
        "No crown history to display yet. Run `/backfill` first.",
      );
      return;
    }

    const canvas = new ChartJSNodeCanvas({
      width: 900,
      height: 500,
      backgroundColour: "white",
    });

    const buffer = await canvas.renderToBuffer({
      type: "bar",
      data: {
        labels: months.map((m) => m.label),
        datasets,
      },
      options: {
        responsive: false,
        plugins: {
          legend: { position: "top" },
          title: {
            display: true,
            text: `${meta.label} Crown Wins; Last ${monthCount} Month${monthCount === 1 ? "" : "s"}`,
            font: { size: 18 },
          },
        },
        scales: {
          x: { stacked: true },
          y: {
            stacked: true,
            beginAtZero: true,
            ticks: { stepSize: 1 },
            title: { display: true, text: "Crowns" },
          },
        },
      },
    });

    const attachment = new AttachmentBuilder(buffer, {
      name: "crown-history.png",
    });
    await interaction.editReply({ files: [attachment] });
  },
};
