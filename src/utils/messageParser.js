/**
 * Extracts structured data from a Discord Message object.
 *
 * @param {import('discord.js').Message} message
 * @returns {{
 *   id: string,
 *   authorId: string,
 *   authorTag: string,
 *   channelId: string,
 *   guildId: string | null,
 *   content: string,
 *   cleanContent: string,
 *   mentionedUserIds: string[],
 *   mentionedRoleIds: string[],
 *   attachments: { id: string, url: string, name: string, contentType: string | null }[],
 *   embeds: import('discord.js').Embed[],
 *   createdAt: Date,
 *   isReply: boolean,
 *   referencedMessageId: string | null,
 * }}
 */
export function parseMessage(message) {
  return {
    id: message.id,
    authorId: message.author.id,
    authorTag: message.author.tag,
    channelId: message.channelId,
    guildId: message.guildId,
    content: message.content,
    cleanContent: message.cleanContent,
    mentionedUserIds: [...message.mentions.users.keys()],
    mentionedRoleIds: [...message.mentions.roles.keys()],
    attachments: message.attachments.map((a) => ({
      id: a.id,
      url: a.url,
      name: a.name,
      contentType: a.contentType,
    })),
    embeds: message.embeds,
    createdAt: message.createdAt,
    isReply: message.reference !== null,
    referencedMessageId: message.reference?.messageId ?? null,
  };
}
