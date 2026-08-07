import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with Pong and current latency"),

  async execute(interaction) {
    const sent = await interaction.reply({
      content: "Pinging…",
      withResponse: true,
    });
    const latency =
      sent.resource.message.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(
      `Pong! Latency: ${latency}ms | API: ${interaction.client.ws.ping}ms`,
    );
  },
};
