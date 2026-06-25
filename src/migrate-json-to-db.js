import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { db } from "./data/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, "../data/crowns.json");
const GAME = "wordle";

const guildId = process.env.GUILD_ID;
if (!guildId) {
  console.error("GUILD_ID is not set in the environment; aborting.");
  process.exit(1);
}

if (!existsSync(JSON_PATH)) {
  console.log(
    `No legacy store found at ${JSON_PATH} — nothing to migrate. The SQLite ` +
      `schema has been created and is ready for use.`,
  );
  process.exit(0);
}

const store = JSON.parse(readFileSync(JSON_PATH, "utf8"));
const users = store.users ?? {};
const nameAliases = store.nameAliases ?? {};
const processedMessageIds = store.processedMessageIds ?? [];

const insertIdPlayer = db.prepare(
  "INSERT INTO players (guild_id, discord_user_id) VALUES (?, ?)",
);
const insertNamePlayer = db.prepare(
  "INSERT INTO players (guild_id, name_key, display_name) VALUES (?, ?, ?)",
);
const insertResult = db.prepare(
  `INSERT INTO results
     (guild_id, game, player_id, puzzle_id, score, is_crown, place, message_id, ts)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insertAlias = db.prepare(
  `INSERT OR REPLACE INTO name_aliases (guild_id, name_key, discord_user_id)
   VALUES (?, ?, ?)`,
);
const insertProcessed = db.prepare(
  `INSERT OR IGNORE INTO processed_messages (guild_id, game, message_id)
   VALUES (?, ?, ?)`,
);

let playerCount = 0;
let resultCount = 0;
let aliasCount = 0;
let processedCount = 0;

db.exec("BEGIN");
try {
  for (const [key, user] of Object.entries(users)) {
    const playerId =
      user.type === "id"
        ? insertIdPlayer.run(guildId, key).lastInsertRowid
        : insertNamePlayer.run(guildId, key, user.displayName ?? null)
            .lastInsertRowid;
    playerCount++;

    for (const s of user.scores ?? []) {
      insertResult.run(
        guildId,
        GAME,
        playerId,
        null,
        s.score,
        s.isCrown ? 1 : 0,
        s.place ?? null,
        s.messageId,
        s.ts,
      );
      resultCount++;
    }
  }

  for (const [nk, uid] of Object.entries(nameAliases)) {
    insertAlias.run(guildId, nk, uid);
    aliasCount++;
  }

  for (const messageId of processedMessageIds) {
    insertProcessed.run(guildId, GAME, messageId);
    processedCount++;
  }

  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  console.error("Migration failed, rolled back:", err);
  process.exit(1);
}

console.log(`Migration complete for guild ${guildId} (game: ${GAME}):`);
console.log(`  players:            ${playerCount}`);
console.log(`  results:            ${resultCount}`);
console.log(`  name aliases:       ${aliasCount}`);
console.log(`  processed messages: ${processedCount}`);
