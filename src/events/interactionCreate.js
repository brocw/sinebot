import { MessageFlags } from "discord.js";
import { autocompleteServer } from "../utils/guildContext.js";

export default {
  name: "interactionCreate",
  once: false,
  async execute(interaction, client) {
    if (interaction.isAutocomplete()) {
      await autocomplete(interaction, client);
      return;
    }
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`[command:${interaction.commandName}]`, err);

      const reply = {
        content: "An error occurred.",
        flags: MessageFlags.Ephemeral,
      };
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply);
        } else {
          await interaction.reply(reply);
        }
      } catch {
        // The interaction token expired or was already resolved elsewhere;
        // the original error above is the one worth keeping.
      }
    }
  },
};

// `server` is shared across commands the way `game` is, so it is answered here
// rather than by each of them; anything else goes to the command's own handler.
async function autocomplete(interaction, client) {
  const handler =
    interaction.options.getFocused(true).name === "server"
      ? autocompleteServer
      : client.commands.get(interaction.commandName)?.autocomplete;
  if (!handler) return;

  try {
    await handler(interaction);
  } catch (err) {
    // Usually the 3-second window closing; the picker just shows no choices.
    console.warn(`[autocomplete:${interaction.commandName}] ${err.message}`);
  }
}
