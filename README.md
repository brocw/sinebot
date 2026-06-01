# SINEBOT

A general-purpose Discord bot built with [Discord.js v14](https://discord.js.org/).

## Features

- **Wordle Crown Tracker** — listens for results posted by the Wordle bot and maintains a persistent crown leaderboard
- **`/crowns`** — displays the Wordle crown leaderboard, ranked by crown count
- **`/backfill`** — scans channel history and rebuilds the crown database from all past results
- **`/link-user`** — maps an unresolved Wordle name to a Discord user and merges their crowns
- **`/ping`** — returns bot and API latency

## Project Structure

```
sinebot/
├── data/
│   └── crowns.json           # persistent crown history (auto-created)
├── src/
│   ├── index.js              # entry point — boots the Discord client
│   ├── loader.js             # auto-loads all files in events/ and commands/
│   ├── deploy-commands.js    # one-time script to register slash commands
│   ├── commands/
│   │   ├── backfill.js       # /backfill history scan command
│   │   ├── crowns.js         # /crowns leaderboard command
│   │   ├── link-user.js      # /link-user alias command
│   │   └── ping.js           # /ping latency command
│   ├── events/
│   │   ├── ready.js          # fires once on login
│   │   ├── messageCreate.js  # routes Wordle bot messages to the parser
│   │   └── interactionCreate.js  # routes slash command interactions
│   ├── utils/
│   │   ├── wordleParser.js   # parses Wordle results messages
│   │   └── messageParser.js  # extracts structured data from any message
│   └── data/
│       └── crownStore.js     # reads and writes crowns.json
└── wordle_message_parsing_examples/  # raw message samples used during development
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in each value:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Bot token from the [Discord Developer Portal](https://discord.com/developers/applications) |
| `CLIENT_ID` | Application ID from the Developer Portal |
| `GUILD_ID` | ID of your Discord server |
| `WORDLE_CHANNEL_ID` | ID of the channel the Wordle bot posts results in |

### 3. Deploy slash commands

This registers slash commands with your server and only needs to be run once (or whenever commands change):

```bash
npm run deploy-commands
```

### 4. Start the bot

```bash
npm start
```

For development with auto-reload on save:

```bash
npm run dev
```

## Wordle Crown Tracker

### How it works

The bot listens for messages from the Wordle bot (user ID `1211781489931452447`) in the configured channel. When a results message is detected, it:

1. Parses the score lines for the `👑` (crown) line — the players with the best score that day
2. Awards a crown to each player on that line
3. Writes the result to `data/crowns.json`

Processing is idempotent — each message is recorded by ID, so restarting the bot will never double-count a result.

### User resolution

The Wordle bot mentions players in two ways depending on whether they have linked their Discord account:

- `<@USER_ID>` — a resolved Discord mention, stored by Discord user ID
- `@Name || Role` — an unresolved name, stored under a normalised name key (e.g. `name:chloe g`)

Both types appear on the leaderboard. Resolved users render as Discord mentions; unresolved users display by name with the role suffix stripped.

### Name aliases

When the same player appears as both a resolved mention (`<@ID>`) and an unresolved name (`@Name`) across different messages, their crowns would otherwise be split across two separate entries. The alias system fixes this.

Use `/link-user` to permanently map a name to a Discord user:

```
/link-user name:"Chloe G" user:@Chloe
```

This immediately merges any crowns already recorded under `name:chloe g` into Chloe's Discord ID entry. All future results for that name are routed to the correct user automatically. After linking, run `/backfill` to reprocess history so past results are also attributed correctly.

Aliases are preserved across backfills — the `nameAliases` table in `crowns.json` is never wiped.

### Backfilling history

When first deploying to a server with existing message history, run `/backfill` to scan the entire channel and build the crown database from scratch. The command is admin-only and reports how many messages were scanned and how many Wordle results were recorded.

```
/backfill
```

The same command can be re-run at any time to rebuild from scratch — useful after adding new name aliases.

### crowns.json schema

```json
{
  "users": {
    "568180354494496768": { "type": "id", "crowns": 5 },
    "name:chloe g":       { "type": "name", "crowns": 3, "displayName": "Chloe G || President" }
  },
  "nameAliases": {
    "name:jacob l": "497964796654911508"
  },
  "processedMessageIds": ["1234567890"]
}
```

## Adding Commands

Create a new file in `src/commands/`. It will be loaded automatically on next start. Export a default object with:

```js
import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('example')
    .setDescription('An example command'),

  async execute(interaction) {
    await interaction.reply('Hello!');
  },
};
```

Then re-run `npm run deploy-commands` to register it with Discord.

## Adding Events

Create a new file in `src/events/`. It will be loaded automatically. Export a default object with:

```js
export default {
  name: 'eventName', // Discord.js event name
  once: false,       // true to fire only on the first occurrence
  execute(...args) {
    // handler
  },
};
```
