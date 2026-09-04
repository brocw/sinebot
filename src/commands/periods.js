import { SlashCommandBuilder, AttachmentBuilder } from "discord.js";
import { gameOption, gameFrom } from "../games/registry.js";
import { renderChart, chrome } from "../charts/render.js";
import {
  seriesColor,
  scale,
  GRID,
  TICK,
  ACCENT,
  GOOD,
  BAD,
  MUTED,
} from "../charts/theme.js";
import { barLabelPlugin } from "../charts/barLabelPlugin.js";
import { guildPeriods, MIN_PLAYS } from "../utils/periods.js";

// The guild-wide answer to the question /stats answers for one player: which
// weekday, and which month, is this server's best and worst.
//
// Plotted as a deviation from the server's own average rather than as the
// average itself. A column of absolute averages is nearly flat — a good Wordle
// weekday and a bad one are three-and-a-half guesses against four — and the
// reader's actual question is "which way off the usual is this day", which is
// exactly what a bar measured from the average shows. The absolute figure is
// still on the axis under each column, so nothing is hidden by the choice.
//
// Colour marks only the two answers: the best column and the worst. Everything
// else is context, and every column's side of the line already carries whether
// it was a good period or a bad one.

const GROUPINGS = {
  weekday: { noun: "day of the week", plural: "days", axis: "Day of the week" },
  month: { noun: "month", plural: "months", axis: "Month" },
};

export default {
  data: new SlashCommandBuilder()
    .setName("periods")
    .setDescription("Chart the server's best and worst days of the week, or months")
    .addStringOption((opt) =>
      opt
        .setName("period")
        .setDescription("What to break the history into (default: day of the week)")
        .addChoices(
          { name: "Day of week", value: "weekday" },
          { name: "Month", value: "month" },
        ),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("count")
        .setDescription("How many recent months to show, 2 to 24 (default: 12) — ignored for day of week")
        .setMinValue(2)
        .setMaxValue(24),
    )
    .addStringOption(gameOption),

  async execute(interaction) {
    await interaction.deferReply();

    const game = gameFrom(interaction);
    const metric = game.periodMetric;
    const grouping = interaction.options.getString("period") ?? "weekday";
    const count = interaction.options.getInteger("count") ?? 12;
    const { noun, plural, axis } = GROUPINGS[grouping];
    const minPlays = MIN_PLAYS[grouping];

    // Every registered game declares one today, but the registry doesn't
    // require it, and a game with no measure to rank on has no best period.
    if (!metric) {
      await interaction.editReply(
        `**${game.label}** has no measure to rank periods on yet.`,
      );
      return;
    }

    const series = game.store.getSeries(interaction.guildId);
    const { buckets, overall, best, worst, thin } = guildPeriods(series, {
      grouping,
      count,
      metric,
    });

    if (!best) {
      await interaction.editReply(
        `Not enough ${game.label} history to call a best or worst ${noun} yet — ` +
          `a ${noun} needs ${minPlays}+ results across the server before it counts. ` +
          "Try `/backfill` first.",
      );
      return;
    }

    const baseline = overall[metric.by];
    const valueOf = (b) => b[metric.by];

    // One qualifying bucket is its own best and worst, which says nothing.
    const single = best.key === worst.key;

    const colorFor = (b) => {
      if (b.key === best.key) return GOOD;
      if (!single && b.key === worst.key) return BAD;
      if (b.plays > 0 && b.plays < minPlays) return MUTED;
      return seriesColor(0);
    };

    const labelFor = (b) => {
      if (b.key === best.key) return `Best · ${metric.format(b)}`;
      if (!single && b.key === worst.key) return `Worst · ${metric.format(b)}`;
      return null;
    };

    const datasets = [
      {
        data: buckets.map((b) =>
          valueOf(b) === null ? null : valueOf(b) - baseline,
        ),
        backgroundColor: buckets.map(colorFor),
        borderColor: buckets.map(colorFor),
        borderWidth: 0,
        barLabels: buckets.map(labelFor),
      },
    ];

    const better = metric.direction === "lower" ? "lower is better" : "higher is better";
    const subtitle = [
      `server average ${metric.format(overall)} over ${overall.plays} results`,
      better,
      thin
        ? `${thin} ${thin === 1 ? "period" : plural} under ${minPlays} results shown in grey, not ranked`
        : null,
    ]
      .filter(Boolean)
      .join("  ·  ");

    const buffer = await renderChart({
      type: "bar",
      data: {
        // Second line is the period's own average, so the deviation on the
        // y-axis never costs the reader the underlying number.
        labels: buckets.map((b) => [
          b.label,
          valueOf(b) === null ? "—" : metric.format(b),
          `n ${b.plays}`,
        ]),
        datasets,
      },
      plugins: [barLabelPlugin],
      options: {
        plugins: chrome({
          title: `${game.label} — best & worst ${noun} across the server`,
          subtitle,
          // A single series, coloured by which column answers the question;
          // a legend would only name the series the title already names.
          legend: false,
        }),
        scales: {
          x: {
            // Names the three lines under each column, in their order.
            ...scale({ title: `${axis}  ·  ${metric.label}  ·  results` }),
            ticks: { color: TICK, autoSkip: false, maxRotation: 0 },
          },
          y: {
            ...scale({
              title: `${metric.label} vs. the server average`,
              grace: "18%",
            }),
            // The line every column is measured from is the subject of the
            // chart, not decoration, so it is drawn as such.
            grid: {
              color: (ctx) => (ctx.tick?.value === 0 ? ACCENT : GRID),
              lineWidth: (ctx) => (ctx.tick?.value === 0 ? 2 : 1),
            },
          },
        },
      },
    });

    const summary = single
      ? `▪️ Only one ${noun} has enough results to rank so far: **${best.label}** — ${metric.format(best)}.`
      : `🔼 Best ${noun}: **${best.label}** — ${metric.format(best)}  ·  ` +
        `🔽 Worst: **${worst.label}** — ${metric.format(worst)}`;

    await interaction.editReply({
      content: summary,
      files: [
        new AttachmentBuilder(buffer, {
          name: `${game.id}-${grouping}-periods.png`,
        }),
      ],
    });
  },
};
