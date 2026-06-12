export const WORDLE_BOT_ID = "1211781489931452447";

/**
 * Returns true if the message is from the Wordle bot.
 * @param {import('discord.js').Message} message
 */
export function isWordleMessage(message) {
  return message.author.id === WORDLE_BOT_ID;
}

/**
 * Parses a Wordle results message.
 *
 * @param {import('discord.js').Message} message
 * @returns {{
 *   streak: number,
 *   scores: {
 *     score: number | null,
 *     isCrown: boolean,
 *     users: ({ type: 'id', id: string } | { type: 'name', raw: string })[]
 *   }[]
 * } | null} null if the message isn't a results post
 */
export function parseWordleResult(message) {
  const lines = message.content.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null;

  const streakMatch = lines[0].match(/on a (\d+) day streak/);
  if (!streakMatch) return null;

  const streak = parseInt(streakMatch[1], 10);
  const scores = [];

  for (const line of lines.slice(1)) {
    const isCrown = line.startsWith("👑");
    const scoreMatch = line.match(/([X\d])\/6:\s*(.*)/);
    if (!scoreMatch) continue;

    const score = scoreMatch[1] === "X" ? null : parseInt(scoreMatch[1], 10);
    const users = parseUsers(scoreMatch[2]);
    scores.push({ score, isCrown, users });
  }

  return { streak, scores };
}

/**
 * Tokenizes the user portion of a score line.
 * Handles both <@ID> Discord mentions and @Name (|| Role) unresolved mentions.
 *
 * @param {string} text
 * @returns {({ type: 'id', id: string } | { type: 'name', raw: string })[]}
 */
function parseUsers(text) {
  const users = [];
  // Match <@ID> and @Name in document order so mixed lines stay ordered.
  const token = /<@(\d+)>|@([^@<]+)/g;
  let match;
  while ((match = token.exec(text)) !== null) {
    if (match[1]) {
      users.push({ type: "id", id: match[1] });
    } else {
      const raw = match[2].trim();
      if (raw) users.push({ type: "name", raw });
    }
  }
  return users;
}
