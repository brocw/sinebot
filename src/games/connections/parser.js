// The four NYT Connections category colours. Distinct from Wordle's squares,
// so a Connections share never collides with a Wordle result.
const COLOURS = {
  "🟨": "yellow",
  "🟩": "green",
  "🟦": "blue",
  "🟪": "purple",
};
const SQUARES = new Set(Object.keys(COLOURS));

const REVERSE_RAINBOW = ["purple", "blue", "green", "yellow"];

/**
 * Parses a user-posted NYT Connections share message.
 *
 * Connections is self-shared (each player posts their own grid), so the author
 * of the message *is* the player — unlike Wordle, there are no mentions to
 * resolve. Each grid row is one guess: a row of four identical squares solved a
 * category; any other row is a mistake. The game allows four mistakes, so a
 * failed board has exactly four mistake rows and fewer than four solved groups.
 *
 * The order/colour of the solved rows also drives scoring (Purple First,
 * Reverse Rainbow), and a mistake made with only two groups left is a "slip".
 *
 * @param {import('discord.js').Message} message
 * @returns {{
 *   puzzle: number,
 *   solved: boolean,
 *   mistakes: number,
 *   groupsSolved: number,
 *   solveOrder: string[],
 *   slipMistakes: number,
 *   purpleFirst: boolean,
 *   reverseRainbow: boolean
 * } | null} null if the message isn't a Connections share
 */
export function parseConnectionsResult(message) {
  const lines = message.content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;

  if (lines[0].toLowerCase() !== "connections") return null;

  const puzzleMatch = lines[1].match(/Puzzle #([\d,]+)/i);
  if (!puzzleMatch) return null;
  const puzzle = parseInt(puzzleMatch[1].replace(/,/g, ""), 10);

  // Collect grid rows: lines made of exactly four colour squares. Other lines
  // (e.g. a spoiler note like "|| ... ||") are ignored.
  const rows = [];
  for (const line of lines.slice(2)) {
    const cells = Array.from(line);
    if (cells.length === 4 && cells.every((c) => SQUARES.has(c))) {
      rows.push(cells);
    }
  }
  if (rows.length < 4) return null;

  // Walk rows in order, tracking solve order and slips (a mistake made when
  // only two groups remain — i.e. exactly two already solved).
  const solveOrder = [];
  let mistakes = 0;
  let slipMistakes = 0;
  for (const cells of rows) {
    const isSolve = cells[0] === cells[1] && cells[1] === cells[2] && cells[2] === cells[3];
    if (isSolve) {
      solveOrder.push(COLOURS[cells[0]]);
    } else {
      mistakes++;
      if (solveOrder.length === 2) slipMistakes++;
    }
  }

  const groupsSolved = solveOrder.length;
  const solved = groupsSolved === 4;
  const purpleFirst = solveOrder[0] === "purple";
  const reverseRainbow =
    solved && REVERSE_RAINBOW.every((c, i) => solveOrder[i] === c);

  return {
    puzzle,
    solved,
    mistakes,
    groupsSolved,
    solveOrder,
    slipMistakes,
    purpleFirst,
    reverseRainbow,
  };
}
