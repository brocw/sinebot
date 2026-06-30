import { SlashCommandBuilder } from "discord.js";
import { setConnectionsDm } from "../data/userSettingsStore.js";

export default {
  data: new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Manage your personal SINEBot preferences")
    .addSubcommand((sub) =>
      sub
        .setName("connections-dm")
        .setDescription("Enable or disable DM feedback after posting a Connections result")
        .addStringOption((opt) =>
          opt
            .setName("value")
            .setDescription("on or off")
            .setRequired(true)
            .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" }),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "connections-dm") {
      const value = interaction.options.getString("value") === "on";
      setConnectionsDm(interaction.guildId, interaction.user.id, value);
      await interaction.reply({
        content: value
          ? "You'll now receive a DM with your Connections result breakdown after each post."
          : "You won't receive DM feedback for Connections results anymore.",
        ephemeral: true,
      });
    }
  },
};
