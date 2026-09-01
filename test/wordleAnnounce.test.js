import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sinebot-wordle-"));

const { default: wordle } = await import("../src/games/wordle/index.js");

// The daily post's word and commonality lookups are decoration; every failure
// path in daily.js returns null. Cutting the network off keeps these tests
// offline and deterministic, and exercises the degraded path besides.
globalThis.fetch = async () => {
  throw new Error("offline");
};

/** A Wordle-bot results post, as parseWordleResult expects to find it. */
function wordlePost(isoDate) {
  const content = ["Someone is on a 5 day streak!", "👑 3/6: <@111>", "4/6: <@222>"].join("\n");
  const message = { content, createdAt: new Date(isoDate) };
  return { message, parsed: wordle.parse(message) };
}

test("puzzle numbering matches NYT's days_since_launch", () => {
  // Both checked against https://www.nytimes.com/svc/wordle/v2/<date>.json,
  // which is the same endpoint the announcement's word lookup uses.
  assert.equal(wordle.puzzleNumberFor(new Date("2026-08-31T12:00:00Z")), 1899);
  assert.equal(wordle.puzzleNumberFor(new Date("2026-09-01T12:00:00Z")), 1900);
});

test("the announcement is headed with the puzzle it reports", async () => {
  // The bot posts the morning after, so a post made on the 1st reports #1899.
  const lines = await wordle.announce(wordlePost("2026-09-01T12:00:00Z"));

  assert.equal(lines[0], "🟩🟨⬛ Wordle #1899");
  assert.match(lines.at(-1), /takes the Wordle crown with \*\*3\/6\*\*/);
});

test("the header survives the word lookup being unavailable", async () => {
  const lines = await wordle.announce(wordlePost("2026-09-01T12:00:00Z"));

  // Numbering is local, so only the word line drops out when NYT is unreachable.
  assert.equal(lines.length, 2);
  assert.ok(!lines.some((l) => l.includes("Yesterday's word")));
});

test("no crown recorded means no announcement at all", async () => {
  const message = {
    content: ["Someone is on a 5 day streak!", "4/6: <@222>"].join("\n"),
    createdAt: new Date("2026-09-01T12:00:00Z"),
  };
  const lines = await wordle.announce({ message, parsed: wordle.parse(message) });

  assert.deepEqual(lines, []);
});
