import "dotenv/config";
import { REST, Routes } from "discord.js";
import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const commandFiles = readdirSync(join(__dirname, "commands")).filter((f) =>
  f.endsWith(".js"),
);
const commands = [];

for (const file of commandFiles) {
  const mod = await import(pathToFileURL(join(__dirname, "commands", file)).href);
  commands.push(mod.default.data.toJSON());
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

// Guild-scoped registration is instant but only reaches one server, so it stays
// available for development via `npm run deploy-commands -- --guild`. The
// default is global registration, which every server the bot joins picks up
// (Discord may take up to an hour to propagate).
const guildOnly = process.argv.includes("--guild");

if (guildOnly) {
  if (!process.env.GUILD_ID) {
    console.error("--guild requires GUILD_ID to be set.");
    process.exit(1);
  }
  console.log(
    `Deploying ${commands.length} command(s) to guild ${process.env.GUILD_ID}…`,
  );
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands },
  );
} else {
  console.log(`Deploying ${commands.length} command(s) globally…`);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
    body: commands,
  });
}

console.log("Done.");
