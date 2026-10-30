import { SlashCommandBuilder } from "discord.js";
import { versionString } from "../version.js";
import { GUILD_AND_DM } from "../utils/guildContext.js";

export default {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with Pong, current latency and the running version")
    .setContexts(...GUILD_AND_DM),

  async execute(interaction) {
    const sent = await interaction.reply({
      content: "Pinging…",
      withResponse: true,
    });
    const latency =
      sent.resource.message.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(
      `Pong! Latency: ${latency}ms | API: ${interaction.client.ws.ping}ms | SINEBOT ${versionString()}`,
    );
  },
};
