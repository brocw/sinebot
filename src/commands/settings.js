import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { GAMES, gameOption } from "../games/registry.js";
import { setDmEnabled, setDmEnabledAll, allPrefs } from "../data/userPrefsStore.js";

export default {
  data: new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Manage your personal SINEBOT preferences")
    .addSubcommand((sub) =>
      sub
        .setName("dm")
        .setDescription("Enable or disable DM feedback after posting a result")
        .addStringOption((opt) =>
          opt
            .setName("value")
            .setDescription("on or off")
            .setRequired(true)
            .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" }),
        )
        .addStringOption((opt) =>
          gameOption(opt).setDescription("Which game (default: all games)"),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("show").setDescription("Show your current preferences"),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    // Preferences are global rather than per-server: a DM carries no guild, so
    // replying "stop" there could not otherwise pick a server.
    if (sub === "dm") {
      const enabled = interaction.options.getString("value") === "on";
      const gameId = interaction.options.getString("game");

      if (gameId) {
        setDmEnabled(userId, gameId, enabled);
      } else {
        setDmEnabledAll(userId, GAMES.map((g) => g.id), enabled);
      }

      const scope = gameId ? GAMES.find((g) => g.id === gameId).label : "all games";
      await interaction.reply({
        content: enabled
          ? `You'll now receive a DM with your result breakdown for **${scope}**.`
          : `You won't receive DM feedback for **${scope}** anymore.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "show") {
      const prefs = allPrefs(userId);
      const lines = GAMES.map(
        (g) => `${g.emoji} **${g.label}** — DMs ${prefs[g.id] === false ? "off" : "on"}`,
      );
      await interaction.reply({
        content: `Your preferences (these apply across every server):\n${lines.join("\n")}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
