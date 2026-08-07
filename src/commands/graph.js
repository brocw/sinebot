import { SlashCommandBuilder, AttachmentBuilder } from "discord.js";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { gameOption, gameFrom } from "../games/registry.js";

const COLORS = [
  "#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0", "#9966FF",
  "#FF9F40", "#B0BEC5", "#7BC8A4", "#F4A460", "#DDA0DD",
];

// Renderer construction is expensive (it spins up a canvas and registers Chart.js
// plugins), so build it once rather than per invocation.
const canvas = new ChartJSNodeCanvas({
  width: 1000,
  height: 560,
  backgroundColour: "white",
});

/**
 * Available chart metrics.
 *
 * `value` maps one result row to a number; `aggregate` says how those combine
 * within a bucket; `cumulative` carries totals forward across buckets.
 * `needsPoints` hides point-based metrics for games that don't score points.
 */
const METRICS = {
  crowns: {
    label: "Crowns",
    axis: "Crowns",
    chart: "bar",
    value: (r) => (r.isCrown ? 1 : 0),
    aggregate: "sum",
  },
  "crowns-cumulative": {
    label: "Crowns (cumulative)",
    axis: "Total crowns",
    chart: "line",
    value: (r) => (r.isCrown ? 1 : 0),
    aggregate: "sum",
    cumulative: true,
  },
  points: {
    label: "Points",
    axis: "Points",
    chart: "bar",
    value: (r) => r.points,
    aggregate: "sum",
    needsPoints: true,
  },
  "points-cumulative": {
    label: "Points (cumulative)",
    axis: "Total points",
    chart: "line",
    value: (r) => r.points,
    aggregate: "sum",
    cumulative: true,
    needsPoints: true,
  },
  plays: {
    label: "Days played",
    axis: "Days played",
    chart: "bar",
    value: () => 1,
    aggregate: "sum",
  },
  "avg-score": {
    label: "Average score",
    axis: "Average",
    chart: "line",
    // Losses carry no score, so they're excluded from the mean rather than
    // counted as zero.
    value: (r) => (r.score === null ? null : r.score),
    aggregate: "mean",
  },
};

const METRIC_CHOICES = Object.entries(METRICS).map(([value, m]) => ({
  name: m.label,
  value,
}));

/** Ordered time buckets covering the trailing window, oldest first. */
function buildBuckets(granularity, count) {
  const now = new Date();
  const buckets = [];

  for (let i = count - 1; i >= 0; i--) {
    if (granularity === "week") {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      // Snap to the Monday that starts the week.
      const dow = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - dow);
      d.setHours(0, 0, 0, 0);
      buckets.push({
        key: `w${d.getTime()}`,
        label: d.toLocaleString("en-US", { month: "short", day: "numeric" }),
      });
    } else {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        key: `m${d.getFullYear()}-${d.getMonth()}`,
        label: d.toLocaleString("en-US", { month: "short", year: "2-digit" }),
      });
    }
  }
  return buckets;
}

/** The bucket key a timestamp falls into, matching buildBuckets(). */
function keyFor(ts, granularity) {
  const d = new Date(ts);
  if (granularity === "week") {
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    d.setHours(0, 0, 0, 0);
    return `w${d.getTime()}`;
  }
  return `m${d.getFullYear()}-${d.getMonth()}`;
}

async function resolveLabel(row, guild) {
  if (row.playerType === "name") return row.displayName;
  try {
    return (await guild.members.fetch(row.playerKey)).displayName;
  } catch {
    // Left the server, or the member is uncacheable — show a stable stub.
    return `User …${row.playerKey.slice(-4)}`;
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName("graph")
    .setDescription("Chart game performance over time")
    .addStringOption((opt) =>
      opt
        .setName("metric")
        .setDescription("What to plot (default: crowns)")
        .addChoices(...METRIC_CHOICES),
    )
    .addStringOption((opt) =>
      opt
        .setName("period")
        .setDescription("Bucket size (default: monthly)")
        .addChoices(
          { name: "Monthly", value: "month" },
          { name: "Weekly", value: "week" },
        ),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("count")
        .setDescription("How many periods to display (default: 12)")
        .setMinValue(2)
        .setMaxValue(52),
    )
    .addStringOption(gameOption),

  async execute(interaction) {
    await interaction.deferReply();

    const game = gameFrom(interaction);
    const metricId = interaction.options.getString("metric") ?? "crowns";
    const metric = METRICS[metricId];
    const granularity = interaction.options.getString("period") ?? "month";
    const count = interaction.options.getInteger("count") ?? 12;

    if (metric.needsPoints && !game.hasPoints) {
      await interaction.editReply({
        content: `**${game.label}** doesn't track points, so "${metric.label}" isn't available for it. Try \`metric:Crowns\`.`,
      });
      return;
    }

    const buckets = buildBuckets(granularity, count);
    const index = new Map(buckets.map((b, i) => [b.key, i]));
    const series = game.store.getSeries(interaction.guildId);

    // Accumulate sum + count per player per bucket so either aggregation works.
    const players = new Map();
    for (const row of series) {
      const i = index.get(keyFor(row.ts, granularity));
      if (i === undefined) continue; // outside the window

      const value = metric.value(row);
      if (value === null) continue;

      let p = players.get(row.playerKey);
      if (!p) {
        p = {
          row,
          sums: new Array(buckets.length).fill(0),
          counts: new Array(buckets.length).fill(0),
        };
        players.set(row.playerKey, p);
      }
      p.sums[i] += value;
      p.counts[i] += 1;
    }

    const datasets = [];
    let colorIdx = 0;

    for (const p of players.values()) {
      let data = buckets.map((_, i) =>
        metric.aggregate === "mean"
          ? p.counts[i]
            ? p.sums[i] / p.counts[i]
            : null // gap rather than a false zero
          : p.sums[i],
      );

      if (metric.cumulative) {
        let running = 0;
        data = data.map((v) => (running += v ?? 0));
      }

      // Skip players with nothing in the window.
      if (data.every((v) => v === null || v === 0)) continue;

      const color = COLORS[colorIdx % COLORS.length];
      datasets.push({
        label: await resolveLabel(p.row, interaction.guild),
        data,
        backgroundColor: color,
        borderColor: color,
        borderWidth: metric.chart === "line" ? 2 : 0,
        fill: false,
        tension: 0.25,
        spanGaps: true,
        pointRadius: metric.chart === "line" ? 3 : 0,
      });
      colorIdx++;
    }

    if (datasets.length === 0) {
      await interaction.editReply(
        `No ${game.label} history in this window yet. Try a longer \`count\`, or run \`/backfill\` first.`,
      );
      return;
    }

    const stacked = metric.chart === "bar";
    const periodWord = granularity === "week" ? "Week" : "Month";

    const buffer = await canvas.renderToBuffer({
      type: metric.chart,
      data: { labels: buckets.map((b) => b.label), datasets },
      options: {
        responsive: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top" },
          title: {
            display: true,
            text: `${game.label} — ${metric.label}; Last ${count} ${periodWord}${count === 1 ? "" : "s"}`,
            font: { size: 18 },
          },
        },
        scales: {
          x: { stacked },
          y: {
            stacked,
            beginAtZero: true,
            title: { display: true, text: metric.axis },
            ...(metric.aggregate === "sum" && !metric.cumulative
              ? { ticks: { precision: 0 } }
              : {}),
          },
        },
      },
    });

    await interaction.editReply({
      files: [
        new AttachmentBuilder(buffer, { name: `${game.id}-${metricId}.png` }),
      ],
    });
  },
};
