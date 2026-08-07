import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function loadEvents(client) {
  const eventsPath = join(__dirname, "events");
  const files = readdirSync(eventsPath).filter((f) => f.endsWith(".js"));

  for (const file of files) {
    const event = await import(pathToFileURL(join(eventsPath, file)).href);
    const { name, once, execute } = event.default;

    // Handlers are wrapped so that one malformed message or a transient API
    // error cannot reject unhandled and take the whole process down — which,
    // serving many guilds, would be an outage for all of them.
    const safeExecute = async (...args) => {
      try {
        await execute(...args, client);
      } catch (err) {
        console.error(`[event:${name}] handler failed:`, err);
      }
    };

    client[once ? "once" : "on"](name, safeExecute);
  }
}

export async function loadCommands(client) {
  const commandsPath = join(__dirname, "commands");
  const files = readdirSync(commandsPath).filter((f) => f.endsWith(".js"));

  for (const file of files) {
    const command = await import(pathToFileURL(join(commandsPath, file)).href);
    const { data, execute } = command.default;
    client.commands.set(data.name, { data, execute });
  }
}
