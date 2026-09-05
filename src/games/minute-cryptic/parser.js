import { puzzleNumberForDate } from "./puzzle.js";

// A Minute Cryptic share:
//
//   Minute Cryptic - 4 September, 2026
//   "Start halfway and stop halfway and flip halfway?" (9)
//   🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣
//   🏆 0 hints – 4 under the community par (192,040 solvers so far).
//   https://www.minutecryptic.com/?utm_source=share
//
// Only the header and the result line carry anything scoreable. The emoji bar
// re-states the hint count in pictures (the coloured pips are hints taken, the
// rest is what was left unused), so it is read as a cross-check and nothing
// more — the written "N hints" is the number that counts.

const HEADER = /^minute cryptic\s*[-–—]\s*(.+?)\.?$/i;
const CLUE = /^["“](.+)["”]\s*\(([^()]+)\)$/;
const HINTS = /(\d+)\s+hints?\b/i;
const PAR = /\b(\d+)\s+(under|over)\s+the\s+community\s+par\b/i;
const MATCHED_PAR = /\bmatch(?:ed|es)\s+the\s+community\s+par\b/i;
const SOLVERS = /\(([\d,]+)\s+solvers/i;
const TIME = /\btime:\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i;

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

// The share writes the day first ("4 September, 2026"). Month-first is accepted
// too: it costs one alternation, and the alternative to accepting it is
// silently dropping every result if the site ever localises the header.
const DAY_FIRST = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+),?\s+(\d{4})$/i;
const MONTH_FIRST = /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i;

function monthIndex(name) {
  const key = name.toLowerCase();
  return MONTHS.findIndex(
    (m) => m === key || (key.length >= 3 && m.startsWith(key)),
  );
}

/**
 * The calendar date in a share header.
 *
 * @returns {{ year: number, month: number, day: number } | null} month is 0-based
 */
function parseShareDate(text) {
  const dayFirst = text.match(DAY_FIRST);
  const monthFirst = dayFirst ? null : text.match(MONTH_FIRST);

  let day, monthName, year;
  if (dayFirst) [, day, monthName, year] = dayFirst;
  else if (monthFirst) [, monthName, day, year] = monthFirst;
  else return null;

  const month = monthIndex(monthName);
  if (month === -1) return null;

  const date = { year: Number(year), month, day: Number(day) };
  // Rejects "31 February": the constructed date rolls over, so a day that
  // doesn't survive the round trip was never a real one.
  const utc = new Date(Date.UTC(date.year, date.month, date.day));
  if (utc.getUTCMonth() !== month || utc.getUTCDate() !== date.day) return null;

  return date;
}

/** Solve time in seconds, or null — the share carries one only sometimes. */
function parseSeconds(text) {
  const m = text.match(TIME);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/**
 * Parses a user-posted Minute Cryptic share.
 *
 * Like Connections, this is self-shared, so the author of the message is the
 * player. Unlike Connections there is no losing state: the puzzle hands out
 * hints until it is solved, so every share is a solve and the interesting
 * number is what it cost — the hint count, and how that compares to the par the
 * rest of the community needed.
 *
 * The par clause is treated as optional. It is present on every share seen so
 * far, but a puzzle too fresh to have a community par is a plausible shape, and
 * dropping a real solve over a missing clause would cost the player their
 * streak.
 *
 * @param {import('discord.js').Message} message
 * @returns {{
 *   puzzle: number,
 *   date: { year: number, month: number, day: number },
 *   hints: number,
 *   par: number | null,
 *   parDelta: number | null,
 *   clue: string | null,
 *   enumeration: string | null,
 *   solvers: number | null,
 *   seconds: number | null
 * } | null} null if the message isn't a Minute Cryptic share
 */
export function parseMinuteCrypticResult(message) {
  const lines = message.content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;

  const header = lines[0].match(HEADER);
  if (!header) return null;

  const date = parseShareDate(header[1]);
  if (!date) return null;

  const body = lines.slice(1);

  const hintLine = body.find((l) => HINTS.test(l));
  if (!hintLine) return null;
  const hints = Number(hintLine.match(HINTS)[1]);

  // Par is reported as a distance and a direction; store it as a signed delta
  // where positive is under par, so "better" and "larger" point the same way.
  let par = null;
  let parDelta = null;
  const parMatch = hintLine.match(PAR);
  if (parMatch) {
    const magnitude = Number(parMatch[1]);
    parDelta = parMatch[2].toLowerCase() === "under" ? magnitude : -magnitude;
    par = hints + parDelta;
  } else if (MATCHED_PAR.test(hintLine)) {
    parDelta = 0;
    par = hints;
  }

  const clueLine = body.map((l) => l.match(CLUE)).find(Boolean);
  const solversMatch = hintLine.match(SOLVERS);

  return {
    puzzle: puzzleNumberForDate(date),
    date,
    hints,
    par,
    parDelta,
    clue: clueLine ? clueLine[1] : null,
    enumeration: clueLine ? clueLine[2].replace(/\s+/g, "") : null,
    solvers: solversMatch ? Number(solversMatch[1].replace(/,/g, "")) : null,
    seconds: parseSeconds(hintLine),
  };
}
