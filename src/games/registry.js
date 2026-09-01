import { readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Every subdirectory of src/games/ holding an index.js is a game. Dropping in a
// new directory registers it everywhere — slash-command choices, message
// routing, /stats, /crowns, /graph, /backfill and the daily summary — with no
// edits to any command or event file.
const REQUIRED = ["id", "label", "emoji", "kind", "store", "parse", "wantsMessage"];

function load() {
  const games = new Map();

  for (const entry of readdirSync(__dirname, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const indexPath = join(__dirname, entry.name, "index.js");
    if (!existsSync(indexPath)) continue;
    games.set(entry.name, indexPath);
  }

  return games;
}

const modules = load();
const registry = new Map();

for (const [name, path] of modules) {
  const mod = await import(pathToFileURL(path).href);
  const game = mod.default;

  const missing = REQUIRED.filter((k) => game?.[k] == null);
  if (missing.length) {
    throw new Error(
      `Game "${name}" is missing required field(s): ${missing.join(", ")}`,
    );
  }
  if (game.id !== name) {
    throw new Error(`Game in directory "${name}" declares mismatched id "${game.id}"`);
  }

  registry.set(game.id, game);
}

/** All registered games, in directory order. */
export const GAMES = [...registry.values()];

/** @returns {object | undefined} */
export function getGame(id) {
  return registry.get(id);
}

export const DEFAULT_GAME = registry.has("wordle") ? "wordle" : GAMES[0]?.id;

/**
 * The `game` option's choices. Exported so a command that needs a variant —
 * `/config dm` adds an "All games" entry — can build one without restating the
 * registry.
 */
export const GAME_CHOICES = GAMES.map((g) => ({ name: g.label, value: g.id }));

/**
 * Adds the standard `game` choice option to a slash command builder.
 * Choices are generated from the registry, so a new game appears automatically
 * on the next `npm run deploy-commands`.
 *
 * Usage: `.addStringOption(gameOption)`
 */
export function gameOption(opt) {
  return opt
    .setName("game")
    .setDescription(`Which game (default: ${registry.get(DEFAULT_GAME)?.label})`)
    .addChoices(...GAME_CHOICES);
}

/** Resolves the `game` option on an interaction to a registry entry. */
export function gameFrom(interaction) {
  return registry.get(interaction.options.getString("game") ?? DEFAULT_GAME);
}
