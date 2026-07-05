import "dotenv/config";
import { Client, GatewayIntentBits, Partials, Collection } from "discord.js";
import { loadEvents } from "./loader.js";
import { loadCommands } from "./loader.js";

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
