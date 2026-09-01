import { SlashCommandBuilder, AttachmentBuilder } from "discord.js";
import { gameOption, gameFrom } from "../games/registry.js";
import { renderChart, chrome } from "../charts/render.js";
import { seriesColor, scale } from "../charts/theme.js";
import { chartLabel } from "../charts/labels.js";
import {
  avatarPlugin,
  loadAvatars,
  AVATAR_PADDING,
} from "../charts/avatarPlugin.js";
import { linearRegression } from "../utils/stats.js";

/**
 * Available chart metrics.
 *
 * Both are running totals: `value` maps one result row to a number, those are
 * summed within each bucket, and the buckets accumulate across the window. The
 * per-bucket metrics this used to offer (crowns and points on their own, days
 * played, average score) were noisier than they were informative — a running
 * total is what people actually read a leaderboard chart for.
 *
 * `needsPoints` hides the point-based metric for games that don't score points.
 */
const METRICS = {
  crowns: {
    label: "Crowns",
    axis: "Total crowns",
    value: (r) => (r.isCrown ? 1 : 0),
  },
  points: {
    label: "Points",
    axis: "Total points",
    value: (r) => r.points,
    needsPoints: true,
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
 * rather than doubling the calls when they're switched on. Names go through
 * `chartLabel` because the canvas cannot draw emoji.
 */
async function resolveMember(row, guild) {
  if (row.playerType === "name") {
    // An unresolved Wordle name has no Discord account behind it, so there is
    // no avatar to show until /link-user maps it.
    return {
      label: chartLabel(row.displayName, "Unlinked player"),
      avatarUrl: null,
    };
  }
  try {
    const member = await guild.members.fetch(row.playerKey);
    // Usernames are restricted to plain characters, so they always draw — the
    // last resort when a display name is nothing but emoji.
    return {
      label: chartLabel(member.displayName, member.user.username),
      avatarUrl: member.displayAvatarURL({ extension: "png", size: 64 }),
    };
  } catch {
    // Left the server, or the member is uncacheable — show a stable stub.
    return { label: `User …${row.playerKey.slice(-4)}`, avatarUrl: null };
  }
}

/** "y = 0.42x − 1.31  (R² 0.97)" */
function equationOf(fit) {
  const sign = fit.intercept < 0 ? "−" : "+";
  return `y = ${fit.slope.toFixed(2)}x ${sign} ${Math.abs(fit.intercept).toFixed(2)}  (R² ${fit.r2.toFixed(2)})`;
}

export default {
  data: new SlashCommandBuilder()
    .setName("graph")
    .setDescription("Chart running totals of game performance over time")
    .addStringOption((opt) =>
      opt
        .setName("metric")
        .setDescription("What to total up, cumulatively across the window (default: Crowns)")
        .addChoices(...METRIC_CHOICES),
    )
    .addStringOption((opt) =>
      opt
        .setName("period")
        .setDescription("Size of each bucket along the x-axis (default: weekly)")
        .addChoices(
          { name: "Weekly", value: "week" },
          { name: "Monthly", value: "month" },
        ),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("count")
        .setDescription("How many periods back to display, 2 to 52 (default: 12)")
        .setMinValue(2)
        .setMaxValue(52),
    )
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("Plot only this player (default: everyone) — cannot be used with top"),
    )
    .addUserOption((opt) =>
      opt
        .setName("vs")
        .setDescription("Plot a second player, head to head with user"),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("top")
        .setDescription("Plot only the leading N players, 1 to 20 — cannot be used with user/vs")
        .setMinValue(1)
        .setMaxValue(20),
    )
    .addBooleanOption((opt) =>
      opt
        .setName("trend")
        .setDescription("Overlay a least-squares trend line per player, with its equation and R²"),
    )
    .addBooleanOption((opt) =>
      opt
        .setName("avatars")
        .setDescription("Show each player's profile picture past their last point (default: on)"),
    )
    .addStringOption(gameOption),

  async execute(interaction) {
    await interaction.deferReply();

    const game = gameFrom(interaction);
    const metricId = interaction.options.getString("metric") ?? "crowns";
    const metric = METRICS[metricId];
    const granularity = interaction.options.getString("period") ?? "week";
    const count = interaction.options.getInteger("count") ?? 12;

    const user = interaction.options.getUser("user");
    const vs = interaction.options.getUser("vs");
    const top = interaction.options.getInteger("top");
    const trend = interaction.options.getBoolean("trend") ?? false;
    const avatars = interaction.options.getBoolean("avatars") ?? true;

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

    const players = new Map();
    for (const row of series) {
      if (pickedIds.size && !pickedIds.has(row.playerKey)) continue;

      const i = index.get(keyFor(row.ts, granularity));
      if (i === undefined) continue; // outside the window

      let p = players.get(row.playerKey);
      if (!p) {
        p = { row, sums: new Array(buckets.length).fill(0) };
        players.set(row.playerKey, p);
      }
      p.sums[i] += metric.value(row);
    }

    // Resolve each player's plotted series before choosing which to keep, so
    // `top` ranks on the same numbers the chart would draw. A running total
    // only ever goes up, so its last point is both the ranking key and the
    // test for "did this player do anything in the window".
    let plotted = [];
    for (const p of players.values()) {
      let running = 0;
      const data = p.sums.map((v) => (running += v));
      if (data.at(-1) === 0) continue;

      plotted.push({ row: p.row, data, key: data.at(-1) });
    }

    plotted.sort((a, b) => b.key - a.key);
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
        borderWidth: 2,
        fill: false,
        tension: 0.25,
        pointRadius: 3,
      });

      if (!trend) continue;

      const fit = linearRegression(p.data.map((y, x) => ({ x, y })));
      if (!fit) continue;

      datasets.push({
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

    if (avatars) await loadAvatars(datasets);

    const periodWord = granularity === "week" ? "Week" : "Month";
    const periodNoun = granularity === "week" ? "week" : "month";

    const notes = [];
    if (trend) {
      notes.push(
        `Trend: least-squares fit; slope in ${metric.label.toLowerCase()} per ${periodNoun}`,
      );
    }
    if (top) notes.push(`top ${plotted.length} of ${players.size} players`);
    if (missing.length) {
      notes.push(`no data for ${missing.map((u) => u.username).join(", ")}`);
    }

    const buffer = await renderChart({
      type: "line",
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
          x: scale(),
          y: scale({
            title: metric.axis,
            beginAtZero: true,
            // Both metrics are integer running totals, so fractional gridlines
            // would only ever be noise.
            precision: true,
          }),
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
