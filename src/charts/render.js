import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { BACKGROUND, TEXT, TICK, applyDefaults } from "./theme.js";

// One renderer for every chart command. Construction is expensive — it spins up
// a canvas and registers the Chart.js plugins — so it happens once at module
// load rather than per invocation, and every command shares the result. That
// also means sizing and theming can't drift between /graph, /distribution and
// /correlation.

const WIDTH = 1000;
const HEIGHT = 560;

const canvas = new ChartJSNodeCanvas({
  width: WIDTH,
  height: HEIGHT,
  backgroundColour: BACKGROUND,
  chartCallback: applyDefaults,
});

/**
 * Standard title/subtitle/legend block.
 *
 * @param {{
 *   title: string,
 *   subtitle?: string,
 *   legend?: boolean,
 *   legendFilter?: (item: object, data: object) => boolean,
 * }} opts
 *   `legendFilter` keeps a dataset off the legend while leaving it on the
 *   chart — for a mark that is an annotation on another series rather than a
 *   series of its own.
 */
export function chrome({ title, subtitle, legend = true, legendFilter }) {
  return {
    legend: legend
      ? {
          position: "top",
          labels: {
            color: TEXT,
            boxWidth: 14,
            ...(legendFilter ? { filter: legendFilter } : {}),
          },
        }
      : { display: false },
    title: {
      display: true,
      text: title,
      color: TEXT,
      font: { size: 18 },
    },
    ...(subtitle
      ? {
          subtitle: {
            display: true,
            text: subtitle,
            color: TICK,
            font: { size: 13, style: "italic" },
            padding: { bottom: 8 },
          },
        }
      : {}),
  };
}

/**
 * Renders a Chart.js configuration to a PNG buffer.
 *
 * @param {object} configuration  passed through to Chart.js unchanged, so
 *   per-chart `plugins: [...]` entries work as normal
 * @returns {Promise<Buffer>}
 */
export function renderChart(configuration) {
  return canvas.renderToBuffer(configuration);
}

export { WIDTH, HEIGHT };
