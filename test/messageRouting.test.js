import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sinebot-routing-"));
// Ensure the legacy env fallback can't mask a missing guild_config row.
delete process.env.WORDLE_CHANNEL_ID;

const { default: handler } = await import("../src/events/messageCreate.js");
const { setChannel } = await import("../src/data/guildConfigStore.js");
const { GAMES, getGame } = await import("../src/games/registry.js");
const { grid, CLEAN_SOLVE } = await import("./helpers.js");

const GUILD = "guild-routing";
const CHANNEL = "chan-games";
setChannel(GUILD, "connections", CHANNEL);

let seq = 0;

/** A message object carrying just enough surface for the router. */
function message(content, { authorId = "alice", bot = false, channelId = CHANNEL } = {}) {
  const sent = { dms: [], channel: [] };
  return {
    sent,
    id: `m-${++seq}`,
    content,
    guildId: GUILD,
    channelId,
    createdTimestamp: Date.now(),
    createdAt: new Date(),
    author: {
      id: authorId,
      bot,
      send: async (text) => sent.dms.push(text),
    },
    channel: { send: async (text) => sent.channel.push(text) },
  };
}

const connectionsPost = (puzzle) =>
  `Connections\nPuzzle #${puzzle}\n${grid(CLEAN_SOLVE)}`;

test("registry discovers both games with the expected kinds", () => {
  assert.deepEqual(
    GAMES.map((g) => [g.id, g.kind]).sort(),
    [
      ["connections", "self-report"],
      ["wordle", "aggregate"],
    ],
  );
});

test("a Connections post in the tracked channel is recorded and DM'd", async () => {
  const m = message(connectionsPost(500));
  await handler.execute(m);

  const stats = getGame("connections").store.getStats(GUILD, "alice");
  assert.equal(stats.games, 1);
  assert.equal(stats.wins, 1);
  assert.equal(m.sent.dms.length, 1, "player receives a breakdown DM");
  assert.match(m.sent.dms[0], /Solved Puzzle #500/);
});

test("the same puzzle posted twice is recorded once and DM'd once", async () => {
  const first = message(connectionsPost(501));
  await handler.execute(first);
  const second = message(connectionsPost(501));
  await handler.execute(second);

  assert.equal(getGame("connections").store.getStats(GUILD, "alice").games, 2);
  assert.equal(second.sent.dms.length, 0, "no DM for a re-share");
});

test("a post outside the tracked channel is ignored", async () => {
  const m = message(connectionsPost(502), { channelId: "somewhere-else" });
  await handler.execute(m);

  const stats = getGame("connections").store.getStats(GUILD, "bob");
  assert.equal(stats, null);
});

test("bot messages are not treated as self-reports", async () => {
  const m = message(connectionsPost(503), { authorId: "bot-user", bot: true });
  await handler.execute(m);
  assert.equal(getGame("connections").store.getStats(GUILD, "bot-user"), null);
});

test("ordinary chatter is ignored without error", async () => {
  const m = message("what did everyone get today");
  await handler.execute(m);
  assert.equal(m.sent.dms.length, 0);
  assert.equal(m.sent.channel.length, 0);
});

test("a DM reply of 'stop' then 'resume' toggles DMs globally", async () => {
  const { dmEnabled } = await import("../src/data/userPrefsStore.js");

  const stop = message("stop");
  stop.guildId = null;
  await handler.execute(stop);
  assert.equal(dmEnabled("alice", "connections"), false);
  assert.equal(dmEnabled("alice", "wordle"), false, "applies to every game");
  assert.match(stop.sent.channel[0], /DMs stopped/);

  // A muted player still gets recorded — they just aren't messaged.
  const m = message(connectionsPost(504));
  await handler.execute(m);
  assert.equal(m.sent.dms.length, 0, "muted player receives no DM");
  assert.equal(getGame("connections").store.getStats(GUILD, "alice").games, 3);

  const resume = message("resume");
  resume.guildId = null;
  await handler.execute(resume);
  assert.equal(dmEnabled("alice", "connections"), true);
});
