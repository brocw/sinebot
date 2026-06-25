// Per-game presentation metadata, shared by the stats/crowns/graph/backfill
// commands so a single `game` option drives all of them.
export const GAMES = {
  wordle: { label: "Wordle", avgLabel: "🎯 Avg. guesses" },
  connections: { label: "Connections", avgLabel: "🎯 Avg. mistakes" },
};

export const DEFAULT_GAME = "wordle";

const GAME_CHOICES = Object.entries(GAMES).map(([value, { label }]) => ({
  name: label,
  value,
}));

/**
 * Adds the standard `game` choice option to a slash command builder option.
 * Usage: `.addStringOption(gameOption)`
 */
export function gameOption(opt) {
  return opt
    .setName("game")
    .setDescription("Which game (default: Wordle)")
    .addChoices(...GAME_CHOICES);
}
