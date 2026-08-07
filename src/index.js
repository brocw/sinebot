import "dotenv/config";
import { Client, GatewayIntentBits, Partials, Collection } from "discord.js";
import { loadEvents, loadCommands } from "./loader.js";

// Last line of defence. Individual handlers are already wrapped in loader.js;
// anything that still escapes gets logged rather than killing the process and
// with it every guild the bot serves.
process.on("unhandledRejection", (err) => {
  console.error("[process] unhandled rejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("[process] uncaught exception:", err);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.commands = new Collection();

await loadCommands(client);
await loadEvents(client);

client.login(process.env.DISCORD_TOKEN);
