import test from "node:test";
import assert from "node:assert/strict";
import { parseConnectionsResult } from "../src/games/connections/parser.js";
import { msg, grid, CLEAN_SOLVE } from "./helpers.js";

const header = "Connections\nPuzzle #123\n";

function parse(rows, { puzzle = "#123" } = {}) {
  return parseConnectionsResult(msg(`Connections\nPuzzle ${puzzle}\n${grid(rows)}`));
}

test("parses a clean solve", () => {
  const r = parse(CLEAN_SOLVE);
  assert.equal(r.puzzle, 123);
  assert.equal(r.solved, true);
  assert.equal(r.mistakes, 0);
  assert.equal(r.groupsSolved, 4);
  assert.deepEqual(r.solveOrder, ["yellow", "green", "blue", "purple"]);
  assert.equal(r.slipMistakes, 0);
  assert.equal(r.purpleFirst, false);
  assert.equal(r.reverseRainbow, false);
});

test("counts a plain mistake", () => {
  const r = parse([
    ["yellow", "yellow", "green", "yellow"],
    ...CLEAN_SOLVE,
  ]);
  assert.equal(r.mistakes, 1);
  assert.equal(r.slipMistakes, 0);
  assert.equal(r.solved, true);
});

test("a mistake with exactly two groups solved is a slip", () => {
  const r = parse([
    ["yellow", "yellow", "yellow", "yellow"],
    ["green", "green", "green", "green"],
    ["blue", "blue", "purple", "blue"], // two solved => slip
    ["blue", "blue", "blue", "blue"],
    ["purple", "purple", "purple", "purple"],
  ]);
  assert.equal(r.mistakes, 1);
  assert.equal(r.slipMistakes, 1);
});

test("detects purple first", () => {
  const r = parse([
    ["purple", "purple", "purple", "purple"],
    ["yellow", "yellow", "yellow", "yellow"],
    ["green", "green", "green", "green"],
    ["blue", "blue", "blue", "blue"],
  ]);
  assert.equal(r.purpleFirst, true);
  assert.equal(r.reverseRainbow, false);
});

test("detects reverse rainbow", () => {
  const r = parse([
    ["purple", "purple", "purple", "purple"],
    ["blue", "blue", "blue", "blue"],
    ["green", "green", "green", "green"],
    ["yellow", "yellow", "yellow", "yellow"],
  ]);
  assert.equal(r.reverseRainbow, true);
  assert.equal(r.purpleFirst, true);
});

test("a failed board is not solved", () => {
  const r = parse([
    ["yellow", "green", "yellow", "yellow"],
    ["yellow", "green", "yellow", "yellow"],
    ["yellow", "green", "yellow", "yellow"],
    ["yellow", "green", "yellow", "yellow"],
  ]);
  assert.equal(r.solved, false);
  assert.equal(r.mistakes, 4);
  assert.equal(r.groupsSolved, 0);
});

test("strips thousands separators from the puzzle number", () => {
  const r = parse(CLEAN_SOLVE, { puzzle: "#1,234" });
  assert.equal(r.puzzle, 1234);
});

test("ignores non-grid lines such as spoiler wrappers", () => {
  const r = parseConnectionsResult(
    msg(`Connections\nPuzzle #123\n||\n${grid(CLEAN_SOLVE)}\n||`),
  );
  assert.equal(r.solved, true);
  assert.equal(r.mistakes, 0);
});

test("rejects non-Connections messages", () => {
  assert.equal(parseConnectionsResult(msg("hello there")), null);
  assert.equal(parseConnectionsResult(msg("Wordle 1,234 4/6\n\n🟩🟩🟩🟩🟩")), null);
  assert.equal(parseConnectionsResult(msg(`${header}not a grid`)), null);
});

test("rejects a grid with fewer than four rows", () => {
  assert.equal(parse(CLEAN_SOLVE.slice(0, 3)), null);
});
