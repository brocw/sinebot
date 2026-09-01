import { SlashCommandBuilder, AttachmentBuilder } from "discord.js";
import { gameOption, gameFrom } from "../games/registry.js";
import { renderChart, chrome } from "../charts/render.js";
import { seriesColor, scale } from "../charts/theme.js";
import {
  avatarPlugin,
  loadAvatars,
  AVATAR_PADDING,
} from "../charts/avatarPlugin.js";
import { linearRegression, mean } from "../utils/stats.js";

/**
 * Available chart metrics.
 *
 * `value` maps one result row to a number; `aggregate` says how those combine
 * within a bucket; `cumulative` carries totals forward across buckets.
 * `needsPoints` hides point-based metrics for games that don't score points.
 * `bestIs` says which end of the metric is good, so `top` ranks correctly —
 * most crowns wins, but *fewest* guesses does.
 */
const METRICS = {
  crowns: {
    label: "Crowns",
    axis: "Crowns",
    chart: "bar",
    value: (r) => (r.isCrown ? 1 : 0),
    aggregate: "sum",
    bestIs: "high",
  },
  "crowns-cumulative": {
    label: "Crowns (cumulative)",
    axis: "Total crowns",
    chart: "line",
    value: (r) => (r.isCrown ? 1 : 0),
    aggregate: "sum",
    cumulative: true,
    bestIs: "high",
  },
  points: {
    label: "Points",
    axis: "Points",
    chart: "bar",
    value: (r) => r.points,
    aggregate: "sum",
    needsPoints: true,
    bestIs: "high",
  },
  "points-cumulative": {
    label: "Points (cumulative)",
    axis: "Total points",
    chart: "line",
    value: (r) => r.points,
    aggregate: "sum",
    cumulative: true,
    needsPoints: true,
    bestIs: "high",
  },
  plays: {
    label: "Days played",
    axis: "Days played",
    chart: "bar",
    value: () => 1,
    aggregate: "sum",
    bestIs: "high",
  },
  "avg-score": {
    label: "Average score",
    axis: "Average",
    chart: "line",
    // Losses carry no score, so they're excluded from the mean rather than
    // counted as zero.
    value: (r) => (r.score === null ? null : r.score),
    aggregate: "mean",
    // Both games' `score` is a "lower is better" figure: Wordle guesses,
    // Connections mistakes.
    bestIs: "low",
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

/**
 * Display name and avatar for a player, from a single member fetch.
 *
 * Resolving the name already cost a fetch, so avatars ride along for free
 * rather than doubling the calls when they're switched on.
 */
async function resolveMember(row, guild) {
  if (row.playerType === "name") {
    // An unresolved Wordle name has no Discord account behind it, so there is
    // no avatar to show until /link-user maps it.
    return { label: row.displayName, avatarUrl: null };
  }
  try {
    const member = await guild.members.fetch(row.playerKey);
    return {
      label: member.displayName,
      avatarUrl: member.displayAvatarURL({ extension: "png", size: 64 }),
    };
  } catch {
    // Left the server, or the member is uncacheable — show a stable stub.
    return { label: `User …${row.playerKey.slice(-4)}`, avatarUrl: null };
  }
}

/** Ranking value for `top`, matching how the metric is actually plotted. */
function rankKey(data, metric) {
  const present = data.filter((v) => v !== null);
  if (present.length === 0) return null;
  if (metric.cumulative) return present.at(-1);
  if (metric.aggregate === "mean") return mean(present);
  return present.reduce((a, b) => a + b, 0);
}

/** "y = 0.42x − 1.31  (R² 0.97)" */
function equationOf(fit) {
  const sign = fit.intercept < 0 ? "−" : "+";
  return `y = ${fit.slope.toFixed(2)}x ${sign} ${Math.abs(fit.intercept).toFixed(2)}  (R² ${fit.r2.toFixed(2)})`;
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
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Plot only this player"),
    )
    .addUserOption((opt) =>
      opt
        .setName("vs")
        .setDescription("Plot a second player, head to head with `user`"),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("top")
        .setDescription("Plot only the top N players for this metric")
        .setMinValue(1)
        .setMaxValue(20),
    )
    .addBooleanOption((opt) =>
      opt
        .setName("trend")
        .setDescription("Overlay a least-squares trend line and its equation"),
    )
    .addBooleanOption((opt) =>
      opt
        .setName("avatars")
        .setDescription("Show profile pictures on line charts (default: on)"),
    )
    .addStringOption(gameOption),

  async execute(interaction) {
    await interaction.deferReply();

    const game = gameFrom(interaction);
    const metricId = interaction.options.getString("metric") ?? "crowns";
    const metric = METRICS[metricId];
    const granularity = interaction.options.getString("period") ?? "month";
    const count = interaction.options.getInteger("count") ?? 12;

    const user = interaction.options.getUser("user");
    const vs = interaction.options.getUser("vs");
    const top = interaction.options.getInteger("top");
    const trend = interaction.options.getBoolean("trend") ?? false;
    const wantsAvatars = interaction.options.getBoolean("avatars") ?? true;

    if (metric.needsPoints && !game.hasPoints) {
      await interaction.editReply({
        content: `**${game.label}** doesn't track points, so "${metric.label}" isn't available for it. Try \`metric:Crowns\`.`,
      });
      return;
    }

    // Naming players and asking for the top N are two different questions;
    // honouring both would silently drop one of them.
    if (top && (user || vs)) {
      await interaction.editReply(
        "Pick either `top` or specific players (`user`/`vs`), not both.",
      );
      return;
    }

    const picked = [user, vs].filter(Boolean);
    const pickedIds = new Set(picked.map((u) => u.id));

    const buckets = buildBuckets(granularity, count);
    const index = new Map(buckets.map((b, i) => [b.key, i]));
    const series = game.store.getSeries(interaction.guildId);

    // Accumulate sum + count per player per bucket so either aggregation works.
    const players = new Map();
    for (const row of series) {
      if (pickedIds.size && !pickedIds.has(row.playerKey)) continue;

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

    // Resolve each player's plotted series before choosing which to keep, so
    // `top` ranks on the same numbers the chart would draw.
    let plotted = [];
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

      plotted.push({ row: p.row, data, key: rankKey(data, metric) });
    }

    plotted.sort((a, b) =>
      metric.bestIs === "low" ? a.key - b.key : b.key - a.key,
    );
    if (top) plotted = plotted.slice(0, top);

    if (plotted.length === 0) {
      const who = picked.length
        ? `No ${game.label} history for ${picked.map((u) => `<@${u.id}>`).join(" or ")} in this window.`
        : `No ${game.label} history in this window yet.`;
      await interaction.editReply(
        `${who} Try a longer \`count\`, or run \`/backfill\` first.`,
      );
      return;
    }

    // Say so when a named player simply isn't in the data, rather than quietly
    // rendering a one-line "head to head".
    const missing = picked.filter(
      (u) => !plotted.some((p) => p.row.playerKey === u.id),
    );

    // Stacking bars hides a trend line behind them, so bars go side by side
    // whenever one is drawn. Called out in the subtitle rather than left to be
    // discovered.
    const unstacked = trend && metric.chart === "bar";
    const stacked = metric.chart === "bar" && !unstacked;

    const datasets = [];
    for (const [i, p] of plotted.entries()) {
      const color = seriesColor(i);
      const { label, avatarUrl } = await resolveMember(p.row, interaction.guild);

      datasets.push({
        label,
        avatarUrl,
        data: p.data,
        backgroundColor: color,
        borderColor: color,
        borderWidth: metric.chart === "line" ? 2 : 0,
        fill: false,
        tension: 0.25,
        spanGaps: true,
        pointRadius: metric.chart === "line" ? 3 : 0,
      });

      if (!trend) continue;

      const points = p.data
        .map((y, x) => ({ x, y }))
        .filter((pt) => pt.y !== null);
      const fit = linearRegression(points);
      if (!fit) continue;

      datasets.push({
        type: "line",
        label: `${label} — ${equationOf(fit)}`,
        data: buckets.map((_, x) => fit.slope * x + fit.intercept),
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 0,
        fill: false,
      });
    }

    // Avatars only make sense against a line's endpoint; bars have no single
    // "last node" to sit beside.
    const avatars = wantsAvatars && metric.chart === "line";
    if (avatars) await loadAvatars(datasets);

    const periodWord = granularity === "week" ? "Week" : "Month";
    const periodNoun = granularity === "week" ? "week" : "month";

    const notes = [];
    if (trend) {
      notes.push(
        `Trend: least-squares fit; slope in ${metric.axis.toLowerCase()} per ${periodNoun}`,
      );
    }
    if (unstacked) notes.push("bars unstacked to keep trend lines readable");
    if (top) notes.push(`top ${plotted.length} of ${players.size} players`);
    if (missing.length) {
      notes.push(`no data for ${missing.map((u) => u.username).join(", ")}`);
    }

    const buffer = await renderChart({
      type: metric.chart,
      data: { labels: buckets.map((b) => b.label), datasets },
      ...(avatars ? { plugins: [avatarPlugin] } : {}),
      options: {
        interaction: { mode: "index", intersect: false },
        ...(avatars ? { layout: { padding: { right: AVATAR_PADDING } } } : {}),
        plugins: chrome({
          title: `${game.label} — ${metric.label}; Last ${count} ${periodWord}${count === 1 ? "" : "s"}`,
          subtitle: notes.join(" · ") || undefined,
        }),
        scales: {
          x: { stacked, ...scale() },
          y: {
            stacked,
            ...scale({
              title: metric.axis,
              beginAtZero: true,
              precision: metric.aggregate === "sum" && !metric.cumulative,
            }),
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
