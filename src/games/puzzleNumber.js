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

/**
 * Daily summary lines for a self-report game: who took yesterday's crown.
 * Returns [] when nobody solved it, so callers can spread the result freely.
 *
 * Any self-report game that declares `puzzleNumberFor` gets this for free.
 *
 * @param {object} game  registry entry
 * @param {string} guildId
 * @param {Date} date    the day the summary is posted
 * @returns {string[]}
 */
export function selfReportSummaryLines(game, guildId, date = new Date()) {
  if (!game.puzzleNumberFor) return [];

  const puzzle = String(game.puzzleNumberFor(date) - 1);
  const { crowns } = game.store.getPuzzleCrowns(guildId, puzzle);
  if (crowns.length === 0) return [];

  // Every crown winner is tied on the top daily score, so any one of them
  // carries the number to report.
  const points = crowns[0].score;
  const verb = crowns.length === 1 ? "takes" : "share";

  return [
    `${game.emoji} ${game.label} #${puzzle}`,
    `👑 ${joinNames(crowns.map((c) => `<@${c.uid}>`))} ${verb} the ${game.label} crown with **${points} points**!`,
  ];
}
