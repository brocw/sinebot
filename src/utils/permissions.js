import { PermissionFlagsBits, MessageFlags } from "discord.js";

// The bot owner, who can run administrative commands in any guild.
export const OWNER_ID = process.env.OWNER_ID ?? "955299747885903903";

/**
 * Administrative commands are gated at runtime rather than with
 * `setDefaultMemberPermissions`. Discord's built-in gate is enforced per-guild
 * and would lock the owner out of any server where they lack Manage Server,
 * which defeats the owner bypass. A runtime check closes the same abuse path.
 */
export function isAdmin(interaction) {
  if (interaction.user.id === OWNER_ID) return true;
  return (
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false
  );
}

/**
 * Replies with a refusal and returns false when the caller is not permitted.
 *
 * @returns {Promise<boolean>} true if the command may proceed
 */
export async function requireAdmin(interaction) {
  if (isAdmin(interaction)) return true;

  await interaction.reply({
    content:
      "You need the **Manage Server** permission to use this command.",
    flags: MessageFlags.Ephemeral,
  });
  return false;
}
