// Chart palette. Every chart the bot posts renders dark, to sit alongside
// Discord's dark embeds rather than flashbanging the channel.

/** Canvas background. Close to Discord's own embed background. */
export const BACKGROUND = "#2b2d31";

export const TEXT = "#e3e5e8"; // titles and legend labels
export const TICK = "#b5bac1"; // axis numbers, deliberately dimmer than TEXT
export const GRID = "rgba(255, 255, 255, 0.08)";
export const ACCENT = "#f0b232"; // trend lines, fitted curves, annotations

/**
 * Categorical series colours, in assignment order.
 *
 * Twenty entries, so a busy server stops repeating colours long after the old
 * ten-colour list did. All are picked for contrast against BACKGROUND — the
 * previous palette's greys and tans disappeared into a dark canvas.
 */
export const SERIES = [
  "#5BC0EB", // sky
  "#FF6B6B", // coral
  "#FFD166", // amber
  "#06D6A0", // teal
  "#C77DFF", // violet
  "#FF9F1C", // orange
  "#4ECDC4", // turquoise
  "#F786AA", // pink
  "#A0E548", // lime
  "#7CA9FF", // cornflower
  "#FFB4A2", // salmon
  "#B388EB", // lavender
  "#6EE7B7", // mint
  "#FDE74C", // yellow
  "#FF8FA3", // rose
  "#63D2FF", // cyan
  "#D4A373", // tan
  "#9BF6FF", // ice
  "#E56B6F", // brick
  "#8AC926", // apple
];

/** The colour for the nth series, wrapping once the palette runs out. */
export function seriesColor(i) {
  return SERIES[i % SERIES.length];
}

/**
 * Applies the palette to Chart.js's global defaults. Called once by the shared
 * renderer, so no individual chart config has to restate its colours.
 */
export function applyDefaults(ChartJS) {
  ChartJS.defaults.color = TEXT;
  ChartJS.defaults.borderColor = GRID;
  ChartJS.defaults.font.size = 13;
}

/**
 * Themed scale options, merged into a chart's `scales` entry.
 *
 * @param {{ title?: string, beginAtZero?: boolean, precision?: boolean }} opts
 */
export function scale({
  title,
  beginAtZero = false,
  precision = false,
  grace,
} = {}) {
  return {
    ...(beginAtZero ? { beginAtZero: true } : {}),
    // Breathing room past the extremes, so a point sitting on the highest or
    // lowest value isn't sliced in half by the axis.
    ...(grace ? { grace } : {}),
    grid: { color: GRID },
    border: { color: GRID },
    ticks: { color: TICK, ...(precision ? { precision: 0 } : {}) },
    ...(title
      ? { title: { display: true, text: title, color: TEXT } }
      : {}),
  };
}
