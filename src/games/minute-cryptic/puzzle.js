import { makePuzzleNumbering } from "../puzzleNumber.js";

/**
 * Minute Cryptic dates its puzzles and never numbers them — the share message
 * says "Minute Cryptic - 4 September, 2026" and the site publishes no number at
 * all. The shared self-report store keys dedup and streaks on a number that
 * advances one per calendar day, so this file mints one: days since 1 January
 * 2022, which predates the game and therefore keeps every real puzzle positive.
 *
 * The number is internal. Anything a player sees goes through
 * `formatPuzzleDate`, so a made-up ordinal is never shown as if it were the
 * game's own.
 */
const EPOCH_UTC = Date.UTC(2022, 0, 1);
const DAY_MS = 86_400_000;

/**
 * Today's puzzle, from the wall clock. Used only by the daily summary, which
 * asks for "yesterday" — the date on a share is authoritative for a recorded
 * result, and that path goes through `puzzleNumberForDate` instead.
 */
export const puzzleNumberForET = makePuzzleNumbering({
  anchorUTC: EPOCH_UTC,
  anchorNumber: 1,
});

/**
 * The puzzle number for a calendar date lifted out of a share.
 *
 * @param {{ year: number, month: number, day: number }} date  month is 0-based
 */
export function puzzleNumberForDate({ year, month, day }) {
  return Math.round((Date.UTC(year, month, day) - EPOCH_UTC) / DAY_MS) + 1;
}

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** The date a puzzle number stands for, as "4 September 2026". */
export function formatPuzzleDate(puzzle) {
  return DATE_FMT.format(new Date(EPOCH_UTC + (Number(puzzle) - 1) * DAY_MS));
}
