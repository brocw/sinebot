import { GAMES } from "../games/registry.js";

export default {
  name: "guildCreate",
  once: false,
  async execute(guild) {
    console.log(`[guild] joined ${guild.name} (${guild.id})`);

    // Nothing is tracked until an admin points each game at a channel, so say
    // so once rather than sitting silent. Best-effort: many servers restrict
    // where bots may post.
    const channel =
      guild.systemChannel ??
      guild.channels.cache.find(
        (c) => c.isTextBased?.() && c.permissionsFor(guild.members.me)?.has("SendMessages"),
      );
    if (!channel) return;

    const list = GAMES.map((g) => `${g.emoji} **${g.label}**`).join("\n");
    try {
      await channel.send(
        `Thanks for adding SINEBOT!\n\nI can track:\n${list}\n\n` +
          "An admin needs to tell me where to look — run `/config channel` for each game, " +
          "then `/backfill` to import that channel's history.",
      );
    } catch (err) {
      console.warn(`[guild] could not greet ${guild.id}: ${err.message}`);
    }
  },
};
