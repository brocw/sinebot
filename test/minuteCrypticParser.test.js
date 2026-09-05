import test from "node:test";
import assert from "node:assert/strict";
import { parseMinuteCrypticResult } from "../src/games/minute-cryptic/parser.js";
import { formatPuzzleDate } from "../src/games/minute-cryptic/puzzle.js";
import { msg } from "./helpers.js";

/** A share, with any line overridable. The defaults are a real one. */
function share({
  header = "Minute Cryptic - 4 September, 2026",
  clue = '"Start halfway and stop halfway and flip halfway?" (9)',
  bar = "🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣",
  result = "🏆 0 hints – 4 under the community par (192,040 solvers so far).",
  link = "https://www.minutecryptic.com/?utm_source=share",
} = {}) {
  return parseMinuteCrypticResult(
    msg([header, clue, bar, result, link].filter(Boolean).join("\n")),
  );
}

test("parses a share that beat the par", () => {
  const r = share();
  assert.equal(r.hints, 0);
  assert.equal(r.parDelta, 4);
  assert.equal(r.par, 4);
  assert.equal(r.solvers, 192040);
  assert.equal(r.seconds, null);
  assert.equal(r.clue, "Start halfway and stop halfway and flip halfway?");
  assert.equal(r.enumeration, "9");
});

test("over par reads as a negative delta", () => {
  const r = share({
    result: "🏋 8 hints – 5 over the community par (98,245 solvers so far).",
  });
  assert.equal(r.hints, 8);
  assert.equal(r.parDelta, -5);
  assert.equal(r.par, 3);
});

test("matching the par is a zero delta, not a missing one", () => {
  const r = share({
    result: "🤝 1 hints – matched the community par (222,375 solvers so far).",
  });
  assert.equal(r.hints, 1);
  assert.equal(r.parDelta, 0);
  assert.equal(r.par, 1);
});

test("a reported time is read in seconds", () => {
  const r = share({
    result:
      "🏆 1 hints – 1 under the community par (165,948 solvers so far). Time: 6m 12s.",
  });
  assert.equal(r.seconds, 372);
  assert.equal(share({ result: "🏆 0 hints – 1 under the community par. Time: 45s." }).seconds, 45);
  assert.equal(
    share({ result: "🏋 2 hints – 1 over the community par. Time: 1h 0m 5s." }).seconds,
    3605,
  );
});

test("the puzzle number is the share's own date, whichever way round it is written", () => {
  const number = share().puzzle;
  assert.equal(formatPuzzleDate(number), "4 September 2026");
  assert.equal(share({ header: "Minute Cryptic - September 4, 2026" }).puzzle, number);
  assert.equal(share({ header: "Minute Cryptic - 4th Sep 2026" }).puzzle, number);
  // Consecutive days are consecutive numbers — the shared store's streaks and
  // its "recompute every later puzzle" walk both depend on that holding.
  assert.equal(share({ header: "Minute Cryptic - 5 September, 2026" }).puzzle, number + 1);
});

test("a puzzle with no community par yet is still a recordable solve", () => {
  const r = share({ result: "🏆 2 hints" });
  assert.equal(r.hints, 2);
  assert.equal(r.par, null);
  assert.equal(r.parDelta, null);
});

test("the emoji bar and the link are decoration, not requirements", () => {
  const r = share({ bar: null, link: null });
  assert.equal(r.hints, 0);
  assert.equal(r.parDelta, 4);
});

test("rejects anything that isn't a Minute Cryptic share", () => {
  assert.equal(parseMinuteCrypticResult(msg("Minute Cryptic rules")), null);
  assert.equal(parseMinuteCrypticResult(msg("what did everyone get today")), null);
  assert.equal(share({ header: "Minute Cryptic - someday" }), null);
  // A date that doesn't exist would otherwise roll forward into a real one.
  assert.equal(share({ header: "Minute Cryptic - 31 February, 2026" }), null);
  // A header alone carries no result to record.
  assert.equal(share({ clue: null, bar: null, result: null, link: null }), null);
});
