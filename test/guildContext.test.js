import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveGuild, autocompleteServer, sharedGuilds } from "../src/utils/guildContext.js";

// Guilds whose member list is `members`. Fetching anyone else rejects the way
// discord.js does for Unknown Member; nothing starts in the cache, so every
// check goes through fetch.
function guild(id, name, members) {
  return {
    id,
    name,
    members: {
      cache: new Map(),
      fetch: async (userId) => {
        if (!members.includes(userId)) throw new Error("Unknown Member");
        return { id: userId };
      },
    },
  };
}

function interaction({ guilds, guildId = null, server = null, focused = "", deferred = false }) {
  const calls = { reply: [], editReply: [], respond: [] };
  const client = { guilds: { cache: new Map(guilds.map((g) => [g.id, g])) } };
  return {
    calls,
    client,
    guildId,
    guild: guildId ? client.guilds.cache.get(guildId) : null,
    user: { id: "me" },
    deferred,
    replied: false,
    options: {
      getString: (name) => (name === "server" ? server : null),
      getFocused: () => focused,
    },
    reply: async (r) => calls.reply.push(r),
    editReply: async (r) => calls.editReply.push(r),
    respond: async (r) => calls.respond.push(r),
  };
}

const alpha = guild("1", "Alpha", ["me", "you"]);
const beta = guild("2", "Beta", ["me"]);
const gamma = guild("3", "Gamma", ["you"]);

test("in a server, the server itself is used and `server` is ignored", async () => {
  const i = interaction({ guilds: [alpha, beta], guildId: "1", server: "2" });
  const ctx = await resolveGuild(i);
  assert.equal(ctx.guildId, "1");
  assert.equal(ctx.guild, alpha);
});

test("in a DM, the only shared server is picked without asking", async () => {
  const i = interaction({ guilds: [beta, gamma] });
  const ctx = await resolveGuild(i);
  assert.equal(ctx.guildId, "2");
  assert.equal(i.calls.reply.length, 0);
});

test("in a DM, several shared servers prompt for `server`", async () => {
  const i = interaction({ guilds: [alpha, beta, gamma] });
  assert.equal(await resolveGuild(i), null);
  assert.match(i.calls.reply[0].content, /share 2 servers/);
});

test("in a DM, an explicit `server` the caller belongs to is used", async () => {
  const i = interaction({ guilds: [alpha, beta], server: "1" });
  const ctx = await resolveGuild(i);
  assert.equal(ctx.guildId, "1");
});

test("in a DM, a `server` the caller isn't in is refused", async () => {
  const i = interaction({ guilds: [alpha, gamma], server: "3" });
  assert.equal(await resolveGuild(i), null);
  assert.match(i.calls.reply[0].content, /don't share that server/);
});

test("in a DM, a `server` the bot isn't in is refused", async () => {
  const i = interaction({ guilds: [alpha], server: "999" });
  assert.equal(await resolveGuild(i), null);
  assert.equal(i.calls.reply.length, 1);
});

test("in a DM with no shared server, says so", async () => {
  const i = interaction({ guilds: [gamma] });
  assert.equal(await resolveGuild(i), null);
  assert.match(i.calls.reply[0].content, /don't share a server/);
});

test("a deferred command is refused by editing its reply", async () => {
  const i = interaction({ guilds: [alpha, beta], deferred: true });
  assert.equal(await resolveGuild(i), null);
  assert.equal(i.calls.reply.length, 0);
  assert.equal(i.calls.editReply.length, 1);
});

test("sharedGuilds lists only the caller's servers, by name", async () => {
  const i = interaction({ guilds: [beta, gamma, alpha] });
  const shared = await sharedGuilds(i.client, "me");
  assert.deepEqual(shared.map((g) => g.name), ["Alpha", "Beta"]);
});

test("autocomplete offers only shared servers, filtered by what was typed", async () => {
  const i = interaction({ guilds: [alpha, beta, gamma], focused: "BE" });
  await autocompleteServer(i);
  assert.deepEqual(i.calls.respond[0], [{ name: "Beta", value: "2" }]);
});
