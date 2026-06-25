import { getPuzzleCrowns } from "./data/connectionsStore.js";

// NYT Connections puzzle #1 was 2023-06-12. The puzzle number increments by one
// each calendar day (New York time), so it's a deterministic function of the
// date — which lets us name yesterday's puzzle without an aggregator message.
const ANCHOR = Date.UTC(2023, 5, 12);

/**
 * The Connections puzzle number for the New York calendar day of `date`.
 */
export function puzzleNumberForET(date = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .split("-")
    .map(Number);
  const day = Date.UTC(y, m - 1, d);
  return Math.round((day - ANCHOR) / 86400000) + 1;
}

function formatWinners(uids) {
  const names = uids.map((u) => `<@${u}>`);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Builds the Connections portion of the daily summary for the puzzle that closed
 * the day before `date`. Returns an empty array if nobody solved it (no crown),
 * so the caller can simply spread it into the combined message.
 *
 * @param {string} guildId
 * @param {Date} date  the day the summary is posted (e.g. the Wordle bot's message)
 * @returns {string[]}
 */
export function connectionsSummaryLines(guildId, date = new Date()) {
  const puzzle = String(puzzleNumberForET(date) - 1);
  const { crowns } = getPuzzleCrowns(guildId, puzzle);
  if (crowns.length === 0) return [];

  const points = crowns[0].score; // all crown winners share the top daily score
  const verb = crowns.length === 1 ? "takes" : "share";

  return [
    `🟨🟩🟦🟪 Connections #${puzzle}`,
    `👑 ${formatWinners(crowns.map((c) => c.uid))} ${verb} the Connections crown with **${points} points**!`,
  ];
}
