// Charts are drawn by node-canvas, which goes through Cairo — and Cairo has no
// colour-emoji support. An emoji in a Discord display name therefore renders as
// an empty box, or vanishes entirely, wherever it lands on a chart. Since there
// is no font that fixes this (a colour emoji font draws nothing here, and a
// monochrome one would still be a guess about what is installed on the droplet),
// labels are stripped of what cannot be drawn before they reach the canvas.
//
// Decorative letterforms — ᶜᵒᵒˡ, ʟᴜᴄ, accented Latin — draw correctly and are
// deliberately left alone. Only emoji and their joiners go.

const UNRENDERABLE = new RegExp(
  "[\\p{Extended_Pictographic}\\p{Emoji_Modifier}\\p{Regional_Indicator}]" +
    "|[\\uFE0E\\uFE0F\\u200D\\u20E3]", // variation selectors, ZWJ, keycap
  "gu",
);

/**
 * A display name safe to draw on a chart.
 *
 * @param {string | null | undefined} text
 * @param {string} fallback  used when nothing legible survives — a name made
 *   entirely of emoji strips to the empty string, and an unlabelled series is
 *   worse than an approximate label
 * @returns {string}
 */
export function chartLabel(text, fallback) {
  const cleaned = (text ?? "").replace(UNRENDERABLE, "").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}
