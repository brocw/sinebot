import { SlashCommandBuilder, AttachmentBuilder } from "discord.js";
import { GAMES, gameOption, gameFrom } from "../games/registry.js";
import { renderChart, chrome } from "../charts/render.js";
import { seriesColor, scale, ACCENT } from "../charts/theme.js";
import { mean, median, stdev, histogram, normalPdf } from "../utils/stats.js";

// Bell curve: how often each outcome actually happens, with the normal
// distribution that best fits it drawn over the top. The gap between the bars
// and the curve is the interesting part — Wordle guesses in particular are
// bounded at 6 and pile up against that ceiling, which a normal curve cannot.

/**
 * Metric choices, pooled from every game's `distributionMetrics`.
 *
 * A game declares what it can plot, so a new game's metrics appear here on the
 * next `npm run deploy-commands` with no edit to this file — the same
 * arrangement `gameOption` uses for the game list itself.
 */
const METRIC_CHOICES = [];
for (const game of GAMES) {
  for (const metric of game.distributionMetrics ?? []) {
    if (METRIC_CHOICES.some((c) => c.value === metric.id)) continue;
    METRIC_CHOICES.push({ name: metric.label, value: metric.id });
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName("distribution")
    .setDescription("Bell curve: how often each result comes up")
    .addStringOption((opt) =>
      opt
        .setName("metric")
        .setDescription("What to plot the spread of")
        .addChoices(...METRIC_CHOICES),
    )
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("Just this player (default: the whole server)"),
    )
    .addStringOption(gameOption),

  async execute(interaction) {
    await interaction.deferReply();

    const game = gameFrom(interaction);
    const available = game.distributionMetrics ?? [];

    if (available.length === 0) {
      await interaction.editReply(
        `**${game.label}** has nothing to plot a distribution of yet.`,
      );
      return;
    }

    const metricId = interaction.options.getString("metric");
    const metric = metricId
      ? available.find((m) => m.id === metricId)
      : available[0];

    // The metric list is pooled across games, so a valid choice can still be
    // the wrong one for the selected game.
    if (!metric) {
      const names = available.map((m) => `\`${m.label}\``).join(", ");
      await interaction.editReply(
        `**${game.label}** doesn't track that. Available: ${names}.`,
      );
      return;
    }

    const user = interaction.options.getUser("user");

    const values = [];
    for (const row of game.store.getSeries(interaction.guildId)) {
      if (user && row.playerKey !== user.id) continue;
      const value = metric.valueOf(row);
      // A loss carries no score; it is an absent result, not a zero.
      if (typeof value === "number") values.push(value);
    }

    if (values.length < 2) {
      const who = user ? `for ${user}` : "yet";
      await interaction.editReply(
        `Not enough ${game.label} results ${who} to plot a distribution. Try \`/backfill\` first.`,
      );
      return;
    }

    const bins = histogram(values, metric);
    const mu = mean(values);
    const sigma = stdev(values);
    const med = median(values);

    const datasets = [
      {
        type: "bar",
        label: metric.axis ?? "Days",
        data: bins.map((b) => b.count),
        backgroundColor: seriesColor(0),
        borderColor: seriesColor(0),
        borderWidth: 0,
      },
    ];

    // Scale the density to counts: expected days in a bin is n × density ×
    // bin width, which puts the curve in the same units as the bars.
    if (sigma) {
      const width = bins.length > 1 ? bins[1].mid - bins[0].mid : 1;
      datasets.push({
        type: "line",
        label: "Normal fit",
        data: bins.map((b) => values.length * normalPdf(b.mid, mu, sigma) * width),
        borderColor: ACCENT,
        backgroundColor: ACCENT,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.4,
        fill: false,
      });
    }

    const who = user ? (user.displayName ?? user.username) : "everyone";
    const summary = [
      `n = ${values.length}`,
      `mean ${mu.toFixed(2)}`,
      `median ${med.toFixed(2)}`,
      sigma === null ? null : `σ ${sigma.toFixed(2)}`,
    ]
      .filter(Boolean)
      .join("  ·  ");

    const buffer = await renderChart({
      type: "bar",
      data: { labels: bins.map((b) => b.label), datasets },
      options: {
        plugins: chrome({
          title: `${game.label} — ${metric.label} distribution (${who})`,
          subtitle: summary,
        }),
        scales: {
          x: scale({ title: metric.label }),
          y: scale({
            title: metric.axis ?? "Days",
            beginAtZero: true,
            precision: true,
          }),
        },
      },
    });

    await interaction.editReply({
      files: [
        new AttachmentBuilder(buffer, {
          name: `${game.id}-${metric.id}-distribution.png`,
        }),
      ],
    });
  },
};
