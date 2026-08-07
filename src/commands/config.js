import {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import { GAMES, gameOption, getGame } from "../games/registry.js";
import { setChannel, setEnabled, guildConfig } from "../data/guildConfigStore.js";
import { requireAdmin } from "../utils/permissions.js";

export default {
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configure which channels SINEBOT tracks in this server")
    .addSubcommand((sub) =>
      sub
        .setName("channel")
        .setDescription("Set the channel a game is tracked in")
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
        .setDescription("Stop tracking a game in this server")
        .addStringOption((opt) => gameOption(opt).setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub.setName("show").setDescription("Show this server's tracking configuration"),
    ),

  async execute(interaction) {
    if (!(await requireAdmin(interaction))) return;

    const sub = interaction.options.getSubcommand();

    if (sub === "show") {
      const configured = new Map(guildConfig(interaction.guildId).map((c) => [c.game, c]));
      const lines = GAMES.map((g) => {
        const c = configured.get(g.id);
        if (!c) return `${g.emoji} **${g.label}** — not configured`;
        if (!c.enabled) return `${g.emoji} **${g.label}** — disabled`;
        return `${g.emoji} **${g.label}** — <#${c.channelId}>`;
      });

      const embed = new EmbedBuilder()
        .setTitle("SINEBOT configuration")
        .setColor(0x5865f2)
        .setDescription(lines.join("\n"));

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
