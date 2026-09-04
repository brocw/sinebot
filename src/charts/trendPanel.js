import { TEXT, TICK, GRID } from "./theme.js";

// Puts each trend line's equation inside the plot, in a small panel, instead of
// in the legend.
//
// The legend was the wrong home for them: a legend entry is an identity — a
// swatch and a name — and hanging "y = 0.42x + 1.31 (R² 0.97)" off the end of
// one turned a tidy row of names into a wrapping wall of algebra above the
// chart, pushing the plot down as more players were added. The equations are an
// annotation on the lines, so they are drawn on the lines' own canvas, and the
// legend goes back to naming players.
//
// Top-left is deliberate. /graph plots running totals, which only ever climb
// left to right, so the top-left corner is the one region of the plot the data
// reliably leaves empty.

const PAD = 10; // panel interior
const ROW = 18; // per equation
const SWATCH = 16; // dashed sample of the trend line
const GAP = 8; // swatch to text
const INSET = 12; // panel to plot edge

const NAME_FONT = "600 12px sans-serif";
const EQUATION_FONT = "12px sans-serif";
const OVERFLOW_FONT = "italic 12px sans-serif";

/** BACKGROUND at 88%, so a gridline under the panel doesn't muddy the text. */
const PANEL = "rgba(43, 45, 49, 0.88)";

/** Never let the panel eat more than this much of the plot's height. */
const MAX_SHARE = 0.5;

export const trendPanel = {
  id: "trendPanel",

  afterDatasetsDraw(chart) {
    const { ctx, chartArea } = chart;

    const entries = chart.data.datasets
      .map((dataset, i) => ({ dataset, i }))
      .filter(({ dataset, i }) => dataset.equation && !chart.getDatasetMeta(i).hidden)
      .map(({ dataset }) => ({
        name: dataset.trendName ?? dataset.label ?? "",
        equation: dataset.equation,
        color: dataset.borderColor ?? dataset.backgroundColor,
      }));

    if (entries.length === 0) return;

    // A twenty-player chart would otherwise paper over its own lines. Showing
    // the first few and saying how many are left beats silently dropping the
    // rest, and beats covering the plot.
    const room = Math.floor((chartArea.height * MAX_SHARE - PAD * 2) / ROW);
    const shown = entries.slice(0, Math.max(1, room));
    const hidden = entries.length - shown.length;

    ctx.save();

    const width = (() => {
      let widest = 0;
      for (const entry of shown) {
        ctx.font = NAME_FONT;
        const name = ctx.measureText(`${entry.name}  `).width;
        ctx.font = EQUATION_FONT;
        widest = Math.max(widest, name + ctx.measureText(entry.equation).width);
      }
      if (hidden) {
        ctx.font = OVERFLOW_FONT;
        widest = Math.max(widest, ctx.measureText(overflowText(hidden)).width);
      }
      return PAD * 2 + SWATCH + GAP + widest;
    })();

    const rows = shown.length + (hidden ? 1 : 0);
    const height = PAD * 2 + rows * ROW;
    const x = chartArea.left + INSET;
    const y = chartArea.top + INSET;

    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 6);
    ctx.fillStyle = PANEL;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = GRID;
    ctx.stroke();

    ctx.textBaseline = "middle";

    shown.forEach((entry, i) => {
      const midY = y + PAD + i * ROW + ROW / 2;
      const textX = x + PAD + SWATCH + GAP;

      // Dashed, like the line it labels — the trend line is the only dashed
      // thing on the chart, so the swatch says which line without a legend.
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([5, 3]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = entry.color;
      ctx.moveTo(x + PAD, midY);
      ctx.lineTo(x + PAD + SWATCH, midY);
      ctx.stroke();
      ctx.restore();

      ctx.font = NAME_FONT;
      ctx.fillStyle = TEXT;
      ctx.fillText(entry.name, textX, midY);

      ctx.font = EQUATION_FONT;
      ctx.fillStyle = TICK;
      ctx.fillText(entry.equation, textX + nameWidth(ctx, entry.name), midY);
    });

    if (hidden) {
      ctx.font = OVERFLOW_FONT;
      ctx.fillStyle = TICK;
      ctx.fillText(
        overflowText(hidden),
        x + PAD + SWATCH + GAP,
        y + PAD + shown.length * ROW + ROW / 2,
      );
    }

    ctx.restore();
  },
};

function overflowText(hidden) {
  return `+ ${hidden} more not shown`;
}

/** Width of the bold name plus its trailing gap, measured in the name's font. */
function nameWidth(ctx, name) {
  const font = ctx.font;
  ctx.font = NAME_FONT;
  const width = ctx.measureText(`${name}  `).width;
  ctx.font = font;
  return width;
}
