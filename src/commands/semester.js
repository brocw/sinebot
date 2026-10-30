import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { GAMES, GAME_CHOICES, getGame } from "../games/registry.js";
import { leaderboardFields, rankedLines } from "../utils/leaderboard.js";
import {
  currentSemester,
  previousSemester,
  inSemester,
  formatSemester,
  formatRange,
} from "../utils/semesters.js";
import {
  standings,
  champions,
  leadChanges,
  participation,
  improvement,
  nameOf,
} from "../utils/standings.js";

// The academic term as a scoreboard. `/crowns` credits everyone who ever
// played, which on a server with an intake every August means the board is
// mostly a record of who arrived first. A semester is short enough that a
// newcomer can win one.
//
// Nothing here is stored. Every figure is folded out of `store.getSeries()`
// rows filtered to the window, so a `/backfill` corrects semester history the
// same moment it corrects everything else.

const GOLD = 0xf1c40f;

// How many rows each supporting section shows. The standings carry the full
// board; these answer a question about the top of it and get long fast.
const TURNOUT_SHOWN = 5;
const MOVERS_SHOWN = 3;

/** Rows for one game inside one semester. */
function rowsIn(game, guildId, semester) {
  return game.store.getSeries(guildId).filter((r) => inSemester(r.ts, semester));
}

export default {
  data: new SlashCommandBuilder()
    .setName("semester")
    .setDescription("Champions and standings for an academic semester")
    .addStringOption((opt) =>
      opt
        .setName("which")
        .setDescription("Which semester (default: the one in progress)")
        .addChoices(
          { name: "Current", value: "current" },
          { name: "Previous", value: "previous" },
        ),
    )
    .addStringOption((opt) =>
      opt
        .setName("game")
        .setDescription("One game in full (default: every game's champion)")
        .addChoices(...GAME_CHOICES),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const semester =
      interaction.options.getString("which") === "previous"
        ? previousSemester(currentSemester())
        : currentSemester();

    const gameId = interaction.options.getString("game");
    const embed = gameId
      ? gameEmbed(getGame(gameId), interaction.guildId, semester)
      : championsEmbed(interaction.guildId, semester);

    await interaction.editReply({ embeds: [embed] });
  },
};

/** Every game's champion, one field each. */
function championsEmbed(guildId, semester) {
  const embed = new EmbedBuilder()
    .setTitle("🏆 Semester Champions")
    .setDescription(`**${formatSemester(semester)}** · ${formatRange(semester)}`)
    .setColor(GOLD);

  for (const game of GAMES) {
    const rows = rowsIn(game, guildId, semester);
    const entries = standings(rows, game);
    const { champions: winners } = champions(entries, game);

    // A game can have results and still have an empty board — Wordle only ranks
    // players who took a crown — so the two empty cases say different things.
    const empty = rows.length
      ? "Results recorded, but nobody on the board yet."
      : "Nothing recorded this semester.";

    embed.addFields({
      name: `${game.emoji} ${game.label}`,
      // Every winner is tied on top, so they are the first `winners.length`
      // lines of the board — rendered by the game's own leaderboardLine, so
      // there is no second formatter here to drift from the real one.
      value: winners.length
        ? rankedLines(entries, game).slice(0, winners.length).join("\n")
        : empty,
    });
  }

  embed.setFooter({ text: "/semester game:… for one game in full" });
  return embed;
}

/** One game's semester in full. */
function gameEmbed(game, guildId, semester) {
  const rows = rowsIn(game, guildId, semester);
  const entries = standings(rows, game);

  const embed = new EmbedBuilder()
    .setTitle(`${game.emoji} ${game.label} — ${formatSemester(semester)}`)
    .setColor(game.color);

  if (entries.length === 0) {
    return embed.setDescription(
      rows.length
        ? `${rows.length} ${game.label} results between ${formatRange(semester)}, but nobody made the board.`
        : `No ${game.label} results recorded between ${formatRange(semester)}.`,
    );
  }

  const players = new Set(rows.map((r) => r.playerKey)).size;
  embed.setDescription(
    `${formatRange(semester)} · ${rows.length} results from ${players} player${players === 1 ? "" : "s"}`,
  );

  const { champions: winners, runnerUp, gap } = champions(entries, game);
  const { changes } = leadChanges(rows, game);

  // `runnerUp` is the best score that isn't the champions', so the gap is
  // never zero — a tie at the top makes both of them champions instead.
  const margin =
    runnerUp === null
      ? "Uncontested — nobody else made the board."
      : `**+${gap.toLocaleString("en-US")}** clear of ${nameOf(runnerUp)}.`;

  embed.addFields({
    name: winners.length === 1 ? "🏆 Champion" : "🏆 Co-champions",
    value: [
      ...rankedLines(entries, game).slice(0, winners.length),
      margin,
      changes === 0
        ? "Led it wire to wire."
        : `The lead changed hands **${changes}** time${changes === 1 ? "" : "s"}.`,
    ].join("\n"),
  });

  embed.addFields(
    { ...game.leaderboardSummary(entries), inline: true },
    ...leaderboardFields(rankedLines(entries, game), "📊 Standings"),
  );

  const turnout = participation(rows).slice(0, TURNOUT_SHOWN);
  embed.addFields({
    // The denominator is days anybody played, not days in the window — a day
    // the game didn't run here is nobody's absence.
    name: `📅 Turnout · of ${turnout[0].of} day${turnout[0].of === 1 ? "" : "s"} played`,
    value: turnout
      .map((p) => `${nameOf(p)} — ${p.days}/${p.of} (${Math.round(p.rate * 100)}%)`)
      .join("\n"),
  });

  const movers = improvement(rows, rowsIn(game, guildId, previousSemester(semester)), game);
  const metric = game.periodMetric;
  if (metric) {
    const gained = movers.filter((m) => m.delta > 0).slice(0, MOVERS_SHOWN);
    // metric.format takes a bucket and reads metric.by off it, so a bare value
    // is handed over in the shape it expects.
    const show = (v) => metric.format({ [metric.by]: v });
    embed.addFields({
      name: `📈 Most improved · ${metric.label}`,
      value: gained.length
        ? gained
            .map((m) => `🔼 ${nameOf(m)} — ${show(m.from)} → ${show(m.to)}`)
            .join("\n")
        : "Nobody qualified — needs 5+ days played in both semesters.",
    });
  }

  return embed;
}
