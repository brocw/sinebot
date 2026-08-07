// Splits leaderboard lines into <=1024-char chunks for embed fields.
function chunkLines(lines) {
  const chunks = [];
  let current = [];
  for (const line of lines) {
    if ([...current, line].join("\n").length > 1024) {
      chunks.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function leaderboardFields(lines, heading) {
  return chunkLines(lines).map((chunk, i) => ({
    name: i === 0 ? heading : "​",
    value: chunk.join("\n"),
  }));
}

const PLACE_LABELS = ["👑", "🥈", "🥉"];

/** Renders a placement as a medal for the top three, else an ordinal. */
export function placeLabel(n) {
  if (n <= 3) return PLACE_LABELS[n - 1];
  const suffix =
    n % 10 === 1 && n % 100 !== 11
      ? "st"
      : n % 10 === 2 && n % 100 !== 12
        ? "nd"
        : n % 10 === 3 && n % 100 !== 13
          ? "rd"
          : "th";
  return `${n}${suffix}`;
}

/**
 * Numbers leaderboard entries with ties sharing a rank, using each game's
 * declared ranking key.
 *
 * @returns {string[]} rendered lines
 */
export function rankedLines(entries, game) {
  let rank = 0;
  let prev = null;
  return entries.map((e, i) => {
    const key = game.leaderboardRankKey(e);
    if (key !== prev) {
      rank = i + 1;
      prev = key;
    }
    return game.leaderboardLine(rank, e);
  });
}
