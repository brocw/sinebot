// Connections points scoring. Only grid- and history-derivable rules are
// implemented (see connections_score.png): base 100, mistake penalties, the
// Purple First / Reverse Rainbow flair bonuses, and a per-day streak bonus.
export const SCORING = {
  base: 100,
  mistake: -15,
  slip: -30, // a mistake made with only two groups left to solve
  purpleFirst: 15,
  reverseRainbow: 30,
  streakPerDay: 1,
};

/**
 * Per-puzzle base points, excluding the streak bonus. A loss scores 0.
 *
 * @param {{ solved: boolean, mistakes: number, slipMistakes: number,
 *           purpleFirst: boolean, reverseRainbow: boolean }} parsed
 * @returns {number}
 */
export function basePoints({
  solved,
  mistakes,
  slipMistakes,
  purpleFirst,
  reverseRainbow,
}) {
  if (!solved) return 0;

  const regularMistakes = mistakes - slipMistakes;
  const points =
    SCORING.base +
    regularMistakes * SCORING.mistake +
    slipMistakes * SCORING.slip +
    (purpleFirst ? SCORING.purpleFirst : 0) +
    (reverseRainbow ? SCORING.reverseRainbow : 0);

  return Math.max(0, points);
}

/**
 * Final daily score: base points plus the player's streak bonus. A loss
 * (base 0) stays 0 and earns no streak bonus.
 *
 * @param {number} base
 * @param {number} streak  consecutive solved days ending at this puzzle
 * @returns {number}
 */
export function dailyScore(base, streak) {
  if (base <= 0) return 0;
  return base + streak * SCORING.streakPerDay;
}
