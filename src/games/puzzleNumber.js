/**
 * Daily-puzzle numbering.
 *
 * Nearly every daily game numbers its puzzles one per calendar day in a fixed
 * time zone, which makes the number a pure function of the date — no need to
 * wait for an aggregator message to know which puzzle "yesterday" was.
 *
 * @param {{ anchorUTC: number, anchorNumber?: number, timeZone?: string }} opts
 *   `anchorUTC` is Date.UTC(y, m, d) of the day puzzle `anchorNumber` ran.
 * @returns {(date?: Date) => number}
 */
export function makePuzzleNumbering({
  anchorUTC,
  anchorNumber = 1,
  timeZone = "America/New_York",
}) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return function puzzleNumberFor(date = new Date()) {
    const [y, m, d] = fmt.format(date).split("-").map(Number);
    const day = Date.UTC(y, m - 1, d);
    return Math.round((day - anchorUTC) / 86_400_000) + anchorNumber;
  };
}

/** Joins names as "a", "a and b", or "a, b and c". */
export function joinNames(names) {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
