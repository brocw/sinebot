import test from "node:test";
import assert from "node:assert/strict";
import { SCORING, basePoints, dailyScore } from "../src/games/minute-cryptic/score.js";

test("par is what scores, not the raw hint count", () => {
  // Three hints on a puzzle the community needed five for beats two hints on a
  // puzzle it needed two for, even though the hint count is higher.
  assert.ok(
    basePoints({ hints: 3, parDelta: 2 }) > basePoints({ hints: 2, parDelta: 0 }),
  );
});

test("under par pays and over par costs, at the same rate", () => {
  const level = basePoints({ hints: 4, parDelta: 0 });
  assert.equal(level, SCORING.base);
  assert.equal(basePoints({ hints: 2, parDelta: 2 }), level + 2 * SCORING.perHintVsPar);
  assert.equal(basePoints({ hints: 6, parDelta: -2 }), level - 2 * SCORING.perHintVsPar);
});

test("a hintless solve takes the clean bonus", () => {
  assert.equal(
    basePoints({ hints: 0, parDelta: 0 }),
    SCORING.base + SCORING.cleanSolve,
  );
});

test("a share with no par reported scores the base alone", () => {
  assert.equal(basePoints({ hints: 3, parDelta: null }), SCORING.base);
});

test("points never go negative", () => {
  assert.equal(basePoints({ hints: 40, parDelta: -30 }), 0);
});

test("every day played earns the streak bonus, however badly it went", () => {
  assert.equal(dailyScore(100, 5), 105);
  // There is no losing state to withhold it from: the puzzle hands out hints
  // until it is solved, so a floored score is still a day played.
  assert.equal(dailyScore(0, 5), 5);
});
