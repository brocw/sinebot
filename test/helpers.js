// Minimal stand-in for a discord.js Message. The parsers only ever read
// `content` (and, for routing, `author`), so a literal is enough — no need to
// drag the gateway into unit tests.
export function msg(content, { authorId = "111", bot = false } = {}) {
  return {
    id: "msg-1",
    content,
    author: { id: authorId, bot },
    guildId: "guild-1",
    channelId: "chan-1",
    createdTimestamp: 1_700_000_000_000,
  };
}

/** Builds a Connections grid body from rows of colour names. */
const EMOJI = { yellow: "🟨", green: "🟩", blue: "🟦", purple: "🟪" };

export function grid(rows) {
  return rows.map((row) => row.map((c) => EMOJI[c]).join("")).join("\n");
}

/** A solved-in-order board: yellow, green, blue, purple with no mistakes. */
export const CLEAN_SOLVE = [
  ["yellow", "yellow", "yellow", "yellow"],
  ["green", "green", "green", "green"],
  ["blue", "blue", "blue", "blue"],
  ["purple", "purple", "purple", "purple"],
];
