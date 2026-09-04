import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// db.js resolves its file at import time, so point it at a scratch directory
// before anything pulls it in.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sinebot-test-"));

const {
  createAggregateStore,
  linkAlias,
  listUnlinked,
  nameKey,
  displayFromRaw,
} = await import("../src/data/aggregateStore.js");

const store = createAggregateStore("testgame");

let guildSeq = 0;
const newGuild = () => `guild-${++guildSeq}`;

/**
 * Records one day's upstream post.
 *
 * `entries` is [score, ...userIds] per line, so `[3, "a"], [null, "b"]` is
 * "a solved in three, b failed". `day` doubles as the day bucket and the
 * message id, which keeps the dedup key unique without a counter.
 */
function post(guild, day, entries) {
  return store.record(
    guild,
    {
      scores: entries.map(([score, ...users], i) => ({
        score,
        isCrown: i === 0 && score !== null,
        users: users.map((u) =>
          typeof u === "string" && u.startsWith("@")
            ? { type: "name", raw: u.slice(1) }
            : { type: "id", id: u },
        ),
      })),
    },
    `msg-${guild}-${day}`,
    day * 86_400_000 + 4 * 3_600_000,
  );
}

const streakOf = (guild, user) => store.getStats(guild, user).currentStreak;

// --- name keys -------------------------------------------------------------

test("nameKey strips a double-pipe role suffix", () => {
  assert.equal(nameKey("Chloe G || President"), "name:chloe g");
});

test("nameKey strips a single-pipe role suffix", () => {
  assert.equal(
    nameKey("Luc | Graphic Design Lead"),
    "name:luc",
    "the bot writes the separator both ways; one key must serve both",
  );
});

test("nameKey strips a backslash-escaped pipe", () => {
  assert.equal(nameKey("Broc W \\|\\| SINEBOT Lead"), "name:broc w");
  assert.equal(nameKey("Broc W \\| SINEBOT Lead"), "name:broc w");
});

test("nameKey keeps a name that carries no suffix, punctuation and all", () => {
  assert.equal(nameKey("Keanu B\\."), "name:keanu b.");
});

test("both suffix spellings collapse to one key", () => {
  assert.equal(nameKey("Finn Radner | Social Media Guy"), nameKey("Finn Radner"));
  assert.equal(nameKey("Finn Radner || Tech Lead"), nameKey("Finn Radner"));
});

test("displayFromRaw strips either suffix and falls back to the key", () => {
  assert.equal(displayFromRaw("Luc | Graphic Design Lead", "name:luc"), "Luc");
  assert.equal(displayFromRaw("Chloe G || President", "name:chloe g"), "Chloe G");
  assert.equal(displayFromRaw(null, "name:luc"), "luc");
});

// --- streaks ---------------------------------------------------------------

test("counts consecutive solved days", () => {
  const g = newGuild();
  for (const d of [1, 2, 3]) post(g, d, [[3, "a"]]);
  assert.equal(streakOf(g, "a"), 3);
});

test("a failure breaks the streak", () => {
  const g = newGuild();
  post(g, 1, [[3, "a"]]);
  post(g, 2, [[3, "a"]]);
  post(g, 3, [[null, "a"]]);
  assert.equal(streakOf(g, "a"), 0, "the player was there and did not solve it");
});

test("a day the group never posted does not break the streak", () => {
  const g = newGuild();
  // No post on day 3 at all — an upstream outage, not an absence.
  for (const d of [1, 2, 4, 5]) post(g, d, [[3, "a"]]);
  assert.equal(
    streakOf(g, "a"),
    4,
    "nobody could have played a day the bot never posted",
  );
});

test("a streak is not current once the player stops showing up", () => {
  const g = newGuild();
  for (const d of [1, 2, 3]) post(g, d, [[3, "a"]]);
  for (const d of [4, 5, 6]) post(g, d, [[3, "b"]]);
  assert.equal(
    streakOf(g, "a"),
    0,
    "a run that ended three puzzles ago is not a current streak",
  );
  assert.equal(streakOf(g, "b"), 3);
});

test("missing a single posted day resets the streak", () => {
  const g = newGuild();
  post(g, 1, [[3, "a"]]);
  post(g, 2, [[3, "b"]]); // a is absent, but the group did post
  post(g, 3, [[3, "a"]]);
  assert.equal(streakOf(g, "a"), 1);
});

test("the streak survives an outage that spans several days", () => {
  const g = newGuild();
  for (const d of [1, 2]) post(g, d, [[3, "a"]]);
  for (const d of [12, 13]) post(g, d, [[3, "a"]]);
  assert.equal(streakOf(g, "a"), 4);
});

// --- unlinked players ------------------------------------------------------

test("listUnlinked reports names with no Discord account behind them", () => {
  const g = newGuild();
  post(g, 1, [[3, "@Chloe G || President"], [4, "known-id"]]);
  post(g, 2, [[2, "@Chloe G || President"]]);

  const unlinked = listUnlinked(g);
  assert.equal(unlinked.length, 1, "only the name player is unresolved");

  const [chloe] = unlinked;
  assert.equal(chloe.nameKey, "name:chloe g");
  assert.equal(chloe.displayName, "Chloe G");
  assert.equal(chloe.results, 2);
  assert.equal(chloe.crowns, 2);
  assert.deepEqual(chloe.games, ["testgame"]);
  assert.equal(chloe.firstTs < chloe.lastTs, true);
});

test("listUnlinked orders by result count, busiest first", () => {
  const g = newGuild();
  post(g, 1, [[3, "@Quiet One"]]);
  post(g, 2, [[3, "@Busy One"]]);
  post(g, 3, [[3, "@Busy One"]]);

  assert.deepEqual(
    listUnlinked(g).map((e) => e.displayName),
    ["Busy One", "Quiet One"],
  );
});

test("linking a name clears it from the unlinked list", () => {
  const g = newGuild();
  post(g, 1, [[3, "@Chloe G || President"]]);
  assert.equal(listUnlinked(g).length, 1);

  const { mergedCrowns } = linkAlias(g, "Chloe G", "chloe-uid");
  assert.equal(mergedCrowns, 1);
  assert.equal(listUnlinked(g).length, 0);
  assert.equal(store.getStats(g, "chloe-uid").crowns, 1);
});

test("a name linked under one suffix resolves under the other", () => {
  const g = newGuild();
  linkAlias(g, "Finn Radner || Tech Lead", "finn-uid");

  post(g, 1, [[3, "@Finn Radner | Social Media Guy"]]);
  post(g, 2, [[3, "@Finn Radner"]]);

  assert.deepEqual(listUnlinked(g), [], "no suffix should mint a new player");
  assert.equal(store.getStats(g, "finn-uid").games, 2);
  assert.equal(streakOf(g, "finn-uid"), 2, "a role change must not reset a streak");
});
