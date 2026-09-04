import { TEXT } from "./theme.js";

// Writes a short label above chosen bars.
//
// This exists so a chart can say which bar is the good one in words as well as
// in colour. The best/worst pair in `src/charts/theme.js` is separable under
// the common colour-vision deficiencies, but "separable" only means a reader
// can tell the two bars apart — it does not tell them which is which. The label
// does that, and it survives a greyscale screenshot.
//
// Only the bars that carry a label get one: a number over every bar is the
// axis written out twice.

const GAP = 6; // between the top of the bar and the text
const FONT = "600 12px sans-serif";

export const barLabelPlugin = {
  id: "barLabels",

  afterDatasetsDraw(chart) {
    const { ctx } = chart;

    chart.data.datasets.forEach((dataset, i) => {
      const labels = dataset.barLabels;
      if (!labels) return;

      const meta = chart.getDatasetMeta(i);
      if (meta.hidden) return;

      ctx.save();
      ctx.font = FONT;
      ctx.fillStyle = TEXT;
      ctx.textAlign = "center";

      labels.forEach((label, index) => {
        const bar = meta.data?.[index];
        if (!label || !bar) return;

        // `y` is the value edge and `base` the baseline, so a bar hanging below
        // a zero line has its value edge underneath — put the label on the
        // outside of the bar either way rather than inside it.
        const below = bar.y > bar.base;
        ctx.textBaseline = below ? "top" : "bottom";
        ctx.fillText(label, bar.x, below ? bar.y + GAP : bar.y - GAP);
      });

      ctx.restore();
    });
  },
};
