import {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import { GAMES, GAME_CHOICES, gameOption, getGame } from "../games/registry.js";
import { setChannel, setEnabled, guildConfig } from "../data/guildConfigStore.js";
import {
  setDmEnabled,
  setDmEnabledAll,
  allPrefs,
} from "../data/userPrefsStore.js";
import { requireAdmin } from "../utils/permissions.js";

// One command for everything configurable: what the server tracks, and what the
// caller personally hears back about it. Splitting those across /config and
// /settings meant remembering which half a given knob lived in, when the only
// real difference is who may turn it.
//
// Every parameter is required. The subcommands that used to infer a default —
// "all games" when `game` was omitted — say so explicitly instead, since a
// silent default on a preference is indistinguishable from a mistake.

const ALL_GAMES = "all";

export default {
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configure what SINEBOT tracks here, and your own DM preferences")
    .addSubcommand((sub) =>
      sub
        .setName("channel")
        .setDescription("Set the channel a game is tracked in (needs Manage Server)")
        .addStringOption((opt) => gameOption(opt).setRequired(true))
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Channel to watch for results")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("disable")
        .setDescription("Stop tracking a game here, keeping its results (needs Manage Server)")
        .addStringOption((opt) => gameOption(opt).setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("dm")
        .setDescription("Turn your result-breakdown DMs on or off, across every server")
        .addStringOption((opt) =>
          opt
            .setName("game")
            .setDescription("Which game to change, or all of them")
            .setRequired(true)
            .addChoices(...GAME_CHOICES, { name: "All games", value: ALL_GAMES }),
        )
        .addStringOption((opt) =>
          opt
            .setName("value")
            .setDescription("Whether to receive those DMs")
            .setRequired(true)
            .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("show")
        .setDescription("Show this server's tracked channels and your DM preferences"),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // Only the two subcommands that change the server are gated. Anyone may
    // read the configuration or set their own preferences.
    if (sub === "channel" || sub === "disable") {
      if (!(await requireAdmin(interaction))) return;
    }

    if (sub === "show") {
      await showConfig(interaction);
      return;
    }

    if (sub === "dm") {
      await setDmPreference(interaction);
      return;
    }

    const game = getGame(interaction.options.getString("game", true));

    if (sub === "channel") {
      const channel = interaction.options.getChannel("channel", true);
      setChannel(interaction.guildId, game.id, channel.id);
      await interaction.reply({
        content: `${game.emoji} **${game.label}** results will now be tracked in <#${channel.id}>.\nRun \`/backfill game:${game.label}\` to import that channel's history.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "disable") {
      setEnabled(interaction.guildId, game.id, false);
      await interaction.reply({
        content: `${game.emoji} **${game.label}** is no longer tracked here. Recorded results are kept — re-enable with \`/config channel\`.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

/** Both halves at once: what the server tracks, and what the caller hears. */
async function showConfig(interaction) {
  const configured = new Map(
    guildConfig(interaction.guildId).map((c) => [c.game, c]),
  );
  const tracking = GAMES.map((g) => {
    const c = configured.get(g.id);
    if (!c) return `${g.emoji} **${g.label}** — not configured`;
    if (!c.enabled) return `${g.emoji} **${g.label}** — disabled`;
    return `${g.emoji} **${g.label}** — <#${c.channelId}>`;
  });

  const prefs = allPrefs(interaction.user.id);
  const dms = GAMES.map(
    (g) => `${g.emoji} **${g.label}** — DMs ${prefs[g.id] === false ? "off" : "on"}`,
  );

  const embed = new EmbedBuilder()
    .setTitle("SINEBOT configuration")
    .setColor(0x5865f2)
    .addFields(
      { name: "📡 Tracked channels", value: tracking.join("\n") },
      {
        name: "✉️ Your DMs",
        value: `${dms.join("\n")}\n_These apply across every server._`,
      },
    );

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/**
 * DM preferences are global rather than per-server: a DM carries no guild, so
 * replying "stop" there could not otherwise pick a server.
 */
async function setDmPreference(interaction) {
  const enabled = interaction.options.getString("value", true) === "on";
  const gameId = interaction.options.getString("game", true);

  if (gameId === ALL_GAMES) {
    setDmEnabledAll(
      interaction.user.id,
      GAMES.map((g) => g.id),
      enabled,
    );
  } else {
    setDmEnabled(interaction.user.id, gameId, enabled);
  }

  const scope = gameId === ALL_GAMES ? "all games" : getGame(gameId).label;
  await interaction.reply({
    content: enabled
      ? `You'll now receive a DM with your result breakdown for **${scope}**.`
      : `You won't receive DM feedback for **${scope}** anymore.`,
    flags: MessageFlags.Ephemeral,
  });
}
