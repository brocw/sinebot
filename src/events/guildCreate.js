export default {
  name: "guildCreate",
  once: false,
  execute(guild) {
    // Logged and nothing more. The bot used to greet the server with setup
    // instructions, which landed in whichever channel it could post to and read
    // as noise to everyone but the admin who added it.
    console.log(`[guild] joined ${guild.name} (${guild.id})`);
  },
};
