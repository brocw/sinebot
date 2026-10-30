import { GAMES } from "../games/registry.js";
import { versionString } from "../version.js";

export default {
  name: "clientReady",
  once: true,
  execute(client) {
    console.log(
      `SINEBOT ${versionString()} logged in as ${client.user.tag} — serving ${client.guilds.cache.size} guild(s), ` +
        `tracking ${GAMES.length} game(s): ${GAMES.map((g) => g.label).join(", ")}`,
    );
  },
};
