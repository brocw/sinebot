import { SlashCommandBuilder, AttachmentBuilder } from "discord.js";
import { gameOption, gameFrom } from "../games/registry.js";
import { renderChart, chrome } from "../charts/render.js";
import { seriesColor, scale, ACCENT } from "../charts/theme.js";
import { mean, pearson, linearRegression } from "../utils/stats.js";

// One point per day: how the group did on average against how many people ended
// up sharing the crown. The hunch worth testing is that an easy puzzle bunches
// everyone at the top and splits the crown many ways, while a hard one spreads
// the field and leaves a single winner.

const DAY_MS = 86_400_000;

/**
 * Collapses a flat series into one entry per day.
 *
 * Keys on the puzzle number where the game has one and the calendar day where
 * it doesn't, so this works for both store shapes without branching on kind.
 */
function byDay(series) {
  const days = new Map();

  for (const row of series) {
    const key = row.puzzleId ?? Math.floor(row.ts / DAY_MS);
    let day = days.get(key);
    if (!day) {
      day = { key, scores: [], crowns: 0 };
      days.set(key, day);
    }
    // Losses have no score and are left out of the day's average, the same way
    // every other average in the bot treats them.
    if (row.score !== null) day.scores.push(row.score);
    if (row.isCrown) day.crowns++;
  }

  return [...days.values()];
}

export default {
  data: new SlashCommandBuilder()
    .setName("correlation")
    .setDescription("Does an easier day mean more people share the crown?")
    .addStringOption(gameOption),

  async execute(interaction) {
    await interaction.deferReply();

    const game = gameFrom(interaction);
    const days = byDay(game.store.getSeries(interaction.guildId));

    // A day with no crown recorded is a gap in the data rather than a genuine
    // "nobody tied", so it is dropped and the count reported.
    const usable = days.filter((d) => d.scores.length > 0 && d.crowns > 0);
    const skipped = days.length - usable.length;

    if (usable.length < 3) {
      await interaction.editReply(
        `Not enough ${game.label} days recorded to look for a relationship yet. Try \`/backfill\` first.`,
      );
      return;
    }

    const points = usable
      .map((d) => ({ x: mean(d.scores), y: d.crowns }))
      .sort((a, b) => a.x - b.x);

    const r = pearson(
      points.map((p) => p.x),
      points.map((p) => p.y),
    );
    const fit = linearRegression(points);

    const scoreWord = game.scoreLabel ?? "score";

    // With a handful of regular players the same (average, ties) pair recurs
    // constantly, and plain dots stack invisibly — a position holding sixty days
    // looked identical to one holding a single day. Collapse the duplicates and
    // let the radius carry the count instead.
    const stacks = new Map();
    for (const point of points) {
      const key = `${point.x}|${point.y}`;
      const stack = stacks.get(key);
      if (stack) stack.days++;
      else stacks.set(key, { x: point.x, y: point.y, days: 1 });
    }
    const plotted = [...stacks.values()];

    const datasets = [
      {
        type: "scatter",
        label: "One day",
        data: plotted,
        backgroundColor: `${seriesColor(0)}CC`,
        borderColor: seriesColor(0),
        // Area grows with the count, so a doubling looks like a doubling
        // rather than a quadrupling.
        pointRadius: plotted.map((p) => Math.min(18, 4 + 2 * Math.sqrt(p.days - 1))),
      },
    ];

    if (fit) {
      const xs = [points[0].x, points.at(-1).x];
      datasets.push({
        type: "line",
        label: `Fit: y = ${fit.slope.toFixed(2)}x ${fit.intercept < 0 ? "−" : "+"} ${Math.abs(fit.intercept).toFixed(2)}`,
        data: xs.map((x) => ({ x, y: fit.slope * x + fit.intercept })),
        borderColor: ACCENT,
        backgroundColor: ACCENT,
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 0,
        showLine: true,
        fill: false,
      });
    }

    const strength =
      r === null
        ? null
        : Math.abs(r) < 0.2
          ? "essentially none"
          : Math.abs(r) < 0.4
            ? "weak"
            : Math.abs(r) < 0.6
              ? "moderate"
              : "strong";

    const summary = [
      `${usable.length} days`,
      plotted.length < points.length ? "point size = days" : null,
      r === null ? null : `r = ${r.toFixed(2)} (${strength})`,
      skipped ? `${skipped} day${skipped === 1 ? "" : "s"} without a recorded crown excluded` : null,
    ]
      .filter(Boolean)
      .join("  ·  ");

    const buffer = await renderChart({
      type: "scatter",
      data: { datasets },
      options: {
        plugins: chrome({
          title: `${game.label} — group avg. ${scoreWord} vs. players tied for the crown`,
          subtitle: summary,
        }),
        scales: {
          x: {
            type: "linear",
            ...scale({
              title: `Group average ${scoreWord} that day`,
              grace: "6%",
            }),
          },
          y: {
            ...scale({
              title: "Players tied for the crown",
              precision: true,
              grace: "12%",
            }),
            // Pinned rather than beginAtZero, which grace would otherwise pull
            // below zero — there is no such thing as negative ties.
            min: 0,
          },
        },
      },
    });

    await interaction.editReply({
      files: [
        new AttachmentBuilder(buffer, {
          name: `${game.id}-correlation.png`,
        }),
      ],
    });
  },
};
