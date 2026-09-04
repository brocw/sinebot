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
//
// The two are independent sets, and Discord offers a guild its own commands
// *and* the global ones — so anything registered both ways appears twice in
// the picker. Re-running the global deploy cannot fix that, because it never
// touches the guild set. `--clear-guild` empties that set, which is the only
// way back, and leaves the global registrations alone.
const guildOnly = process.argv.includes("--guild");
const clearGuild = process.argv.includes("--clear-guild");

if (guildOnly && clearGuild) {
  console.error("--guild and --clear-guild are opposites; pass one or neither.");
  process.exit(1);
}

if ((guildOnly || clearGuild) && !process.env.GUILD_ID) {
  const flag = guildOnly ? "--guild" : "--clear-guild";
  console.error(`${flag} requires GUILD_ID to be set.`);
  process.exit(1);
}

if (clearGuild) {
  // Deliberately the guild route with an empty body, never the global one:
  // clearing globally would strip every command from every server until the
  // next deploy propagated, which can take an hour.
  console.log(`Clearing guild-scoped commands from ${process.env.GUILD_ID}…`);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: [] },
  );

  const global = await rest.get(Routes.applicationCommands(process.env.CLIENT_ID));
  console.log(
    `Done. ${global.length} global command(s) still registered; the duplicates should clear on the next picker refresh.`,
  );

  if (global.length === 0) {
    console.warn(
      "Warning: nothing is registered globally either. Run `npm run deploy-commands` to restore the command set.",
    );
  }
} else if (guildOnly) {
  console.log(
    `Deploying ${commands.length} command(s) to guild ${process.env.GUILD_ID}…`,
  );
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands },
  );
  console.log(
    "Done. Clear these again with `npm run deploy-commands -- --clear-guild` " +
      "before relying on the global set, or they will show up twice.",
  );
} else {
  console.log(`Deploying ${commands.length} command(s) globally…`);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
    body: commands,
  });
  console.log("Done.");
}
