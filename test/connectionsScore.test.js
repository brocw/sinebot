import test from "node:test";
import assert from "node:assert/strict";
import {
  SCORING,
  basePoints,
  dailyScore,
} from "../src/games/connections/score.js";

const solve = (over = {}) => ({
  solved: true,
  mistakes: 0,
  slipMistakes: 0,
  purpleFirst: false,
  reverseRainbow: false,
  ...over,
});

test("a clean solve scores the base", () => {
  assert.equal(basePoints(solve()), SCORING.base);
});

test("a loss scores zero regardless of flair", () => {
  assert.equal(basePoints(solve({ solved: false, purpleFirst: true })), 0);
});

test("regular and slip mistakes are penalised separately", () => {
  // 2 mistakes, 1 of which is a slip => one regular (-15) + one slip (-30)
  assert.equal(
    basePoints(solve({ mistakes: 2, slipMistakes: 1 })),
    SCORING.base + SCORING.mistake + SCORING.slip,
  );
});

test("flair bonuses stack", () => {
  assert.equal(
    basePoints(solve({ purpleFirst: true, reverseRainbow: true })),
    SCORING.base + SCORING.purpleFirst + SCORING.reverseRainbow,
  );
});

test("base points never go negative", () => {
  assert.equal(basePoints(solve({ mistakes: 4, slipMistakes: 4 })), 0);
});

test("dailyScore adds one point per streak day", () => {
  assert.equal(dailyScore(100, 5), 105);
});

test("dailyScore stays zero for a loss and earns no streak bonus", () => {
  assert.equal(dailyScore(0, 10), 0);
});
