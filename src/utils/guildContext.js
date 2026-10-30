import { InteractionContextType, MessageFlags } from "discord.js";

// Every stat lives under a guild, and a DM has none. Read-only commands run in
// the bot's DMs work out which server they mean here, so the charts and boards
// can be pulled up without posting them in a server channel.
//
// Membership is checked on every path. The `server` option is free text under
// its autocomplete, so without the check anyone could read a server they are
// not in by pasting its ID.

/** Contexts for the read-only commands, which work in a server or in a DM. */
export const GUILD_AND_DM = [InteractionContextType.Guild, InteractionContextType.BotDM];

/** Contexts for commands that act on a server, and so need to be run in one. */
export const GUILD_ONLY = [InteractionContextType.Guild];

/**
 * Adds the `server` option to a slash command builder. Its choices come from
 * `autocompleteServer`, since they differ per user.
 *
 * Usage: `.addStringOption(serverOption)`
 */
export function serverOption(opt) {
  return opt
    .setName("server")
    .setDescription("In DMs: which server's results (default: the one you share with SINEBOT)")
    .setAutocomplete(true);
}

async function isMember(guild, userId) {
  if (guild.members.cache.has(userId)) return true;
  try {
    await guild.members.fetch(userId);
    return true;
  } catch {
    // Unknown Member, or a transient failure; either way, no access.
    return false;
  }
}

/** Every guild the bot is in that `userId` is also a member of, by name. */
export async function sharedGuilds(client, userId) {
  const guilds = [...client.guilds.cache.values()];
  const member = await Promise.all(guilds.map((g) => isMember(g, userId)));
  return guilds
    .filter((_, i) => member[i])
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Answers the `server` option's autocomplete with the caller's shared servers. */
export async function autocompleteServer(interaction) {
  const typed = interaction.options.getFocused().toLowerCase();
  const guilds = await sharedGuilds(interaction.client, interaction.user.id);
  await interaction.respond(
    guilds
      .filter((g) => g.name.toLowerCase().includes(typed))
      .slice(0, 25) // Discord's cap on autocomplete choices
      .map((g) => ({ name: g.name, value: g.id })),
  );
}

/**
 * The guild a command should read from, or null once the caller has been told
 * why there isn't one.
 *
 * In a server that is always the server itself: `server` is ignored there, so
 * one server's results are never posted into another's channel. In a DM it is
 * the `server` option if given, otherwise the only server the caller shares
 * with the bot.
 *
 * @returns {Promise<{ guildId: string, guild: import("discord.js").Guild } | null>}
 */
export async function resolveGuild(interaction) {
  if (interaction.guildId) {
    return { guildId: interaction.guildId, guild: interaction.guild };
  }

  const requested = interaction.options.getString("server");
  const userId = interaction.user.id;

  if (requested) {
    const guild = interaction.client.guilds.cache.get(requested);
    if (guild && (await isMember(guild, userId))) {
      return { guildId: guild.id, guild };
    }
    await refuse(
      interaction,
      "I don't share that server with you. Pick one from the `server` suggestions.",
    );
    return null;
  }

  const shared = await sharedGuilds(interaction.client, userId);
  if (shared.length === 1) return { guildId: shared[0].id, guild: shared[0] };

  await refuse(
    interaction,
    shared.length === 0
      ? "You don't share a server with SINEBOT, so there are no results to show."
      : `You share ${shared.length} servers with SINEBOT — pick one with the \`server\` option.`,
  );
  return null;
}

async function refuse(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}
