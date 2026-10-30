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

/** "1st", "2nd", "11th", "23rd". */
export function ordinal(n) {
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

/** Renders a placement as a medal for the top three, else an ordinal. */
export function placeLabel(n) {
  return n <= 3 ? PLACE_LABELS[n - 1] : ordinal(n);
}

/**
 * Everything an entry is ranked on, most significant first: the game's
 * `leaderboardRankKey`, then whatever `leaderboardTiebreak` it declares (Wordle
 * breaks a crown tie on 🥈 then 🥉).
 */
function rankTuple(game, e) {
  return [game.leaderboardRankKey(e), ...(game.leaderboardTiebreak?.(e) ?? [])];
}

/** Sort comparator, best first, for a game's leaderboard entries. */
export function byRank(game) {
  return (a, b) => {
    const ta = rankTuple(game, a);
    const tb = rankTuple(game, b);
    for (let i = 0; i < ta.length; i++) {
      if (ta[i] !== tb[i]) return tb[i] - ta[i];
    }
    return 0;
  };
}

/** Whether two entries share a rank — level on the key and every tiebreak. */
export function sameRank(game, a, b) {
  return byRank(game)(a, b) === 0;
}

/**
 * Numbers leaderboard entries with ties sharing a rank, using each game's
 * declared ranking key and tiebreaks.
 *
 * @returns {string[]} rendered lines
 */
export function rankedLines(entries, game) {
  let rank = 0;
  return entries.map((e, i) => {
    if (i === 0 || !sameRank(game, entries[i - 1], e)) rank = i + 1;
    return game.leaderboardLine(rank, e);
  });
}
