import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sinebot-wordle-"));

const { default: wordle } = await import("../src/games/wordle/index.js");
const { buildDailySummary, renderDailySummary } = await import("../src/summary/index.js");

// The daily post's word and commonality lookups are decoration; every failure
// path in daily.js returns null. Cutting the network off keeps these tests
// offline and deterministic, and exercises the degraded path besides.
globalThis.fetch = async () => {
  throw new Error("offline");
};

let seq = 0;

/** Records a Wordle-bot results post in a fresh guild, as the live handler does. */
function wordlePost(isoDate, lines = ["👑 3/6: <@111>", "4/6: <@222>"]) {
  const guildId = `guild-${++seq}`;
  const content = ["Your group is on an 89 day streak!", ...lines].join("\n");
  const message = { content, createdAt: new Date(isoDate) };
  const parsed = wordle.parse(message);
  wordle.store.record(guildId, parsed, `msg-${seq}`, message.createdAt.getTime());
  return { guildId, date: message.createdAt, parsed };
}

function summaryOf({ guildId, date, parsed }) {
  return buildDailySummary({
    guildId,
    date,
    games: [wordle],
    parsed: new Map([["wordle", parsed]]),
  });
}

/** Every piece of text in a rendered message, joined. */
const textOf = (message) =>
  JSON.stringify(message.components.map((c) => c.toJSON()));

test("puzzle numbering matches NYT's days_since_launch", () => {
  // Both checked against https://www.nytimes.com/svc/wordle/v2/<date>.json,
  // which is the same endpoint the summary's word lookup uses.
  assert.equal(wordle.puzzleNumberFor(new Date("2026-08-31T12:00:00Z")), 1899);
  assert.equal(wordle.puzzleNumberFor(new Date("2026-09-01T12:00:00Z")), 1900);
});

test("the section is headed with the puzzle it reports", async () => {
  // The bot posts the morning after, so a post made on the 1st reports #1899.
  const { days } = await summaryOf(wordlePost("2026-09-01T12:00:00Z"));

  assert.equal(days[0].title, "🟩🟨⬛ Wordle #1899");
  assert.deepEqual(
    days[0].podium.map((p) => [p.place, p.result, p.names]),
    [
      [1, "3/6", ["<@111>"]],
      [2, "4/6", ["<@222>"]],
    ],
  );
});

test("the group streak and day average come from the upstream post", async () => {
  const { days } = await summaryOf(wordlePost("2026-09-01T12:00:00Z"));

  assert.deepEqual(days[0].stats, ["2 played", "avg 3.50", "🔥 89-day group streak"]);
});

test("the section survives the word lookup being unavailable", async () => {
  const { days } = await summaryOf(wordlePost("2026-09-01T12:00:00Z"));

  // Numbering is local, so only the word line drops out when NYT is unreachable.
  assert.deepEqual(days[0].intro, []);
});

test("a day nobody solved still reports, without a podium", async () => {
  const post = wordlePost("2026-09-01T12:00:00Z", ["X/6: <@111> <@222>"]);
  const summary = await summaryOf(post);

  assert.deepEqual(summary.days[0].podium, []);
  assert.deepEqual(summary.days[0].stats.slice(0, 2), ["2 played", "2 ❌"]);
  assert.match(textOf(renderDailySummary(summary)), /Nobody solved it\./);
});

test("a guild with nothing recorded posts nothing", async () => {
  const summary = await buildDailySummary({
    guildId: "guild-empty",
    date: new Date("2026-09-01T12:00:00Z"),
    games: [wordle],
  });
  assert.equal(summary, null);
});
