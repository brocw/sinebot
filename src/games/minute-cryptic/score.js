// Minute Cryptic points scoring.
//
// Hints are the metric the game itself reports, but a raw hint count is not
// comparable across days: a hard puzzle costs everyone hints, and a player who
// took three on a puzzle the world needed seven for did better than one who
// took two on a giveaway. The community par is the game's own difficulty
// measure, so points are scored on the distance from it, and the hint count is
// reserved for the flat "how much help did you take" stats.
export const SCORING = {
  base: 100,
  perHintVsPar: 12, // per hint under par; the same amount is lost per hint over
  cleanSolve: 20, // no hints at all
  streakPerDay: 1,
};

/**
 * Per-puzzle base points, excluding the streak bonus.
 *
 * A share with no par clause scores the base alone — the solve is real and
 * belongs in the record, there is simply nothing to measure it against.
 *
 * @param {{ hints: number, parDelta: number | null }} parsed
 * @returns {number}
 */
export function basePoints({ hints, parDelta }) {
  const points =
    SCORING.base +
    (parDelta ?? 0) * SCORING.perHintVsPar +
    (hints === 0 ? SCORING.cleanSolve : 0);

  return Math.max(0, points);
}

/**
 * Final daily score: base points plus the player's streak bonus.
 *
 * Minute Cryptic has no losing state — it feeds out hints until the answer
 * falls — so unlike Connections there is no zero-scoring day to withhold the
 * streak bonus from. A day badly enough over par to floor the base at 0 still
 * counts as a day played, and still extends the streak.
 *
 * @param {number} base
 * @param {number} streak  consecutive days played ending at this puzzle
 * @returns {number}
 */
export function dailyScore(base, streak) {
  return base + streak * SCORING.streakPerDay;
}
