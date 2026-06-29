# SINEBOT

A daily game tracker for Connections and Wordle for Discord.

## Features

- **Wordle Crown Tracker** — listens for results posted by the Wordle bot and maintains a persistent crown leaderboard
- **Connections Tracker** — listens for results players self-share and scores them with a points-based system
- **`/crowns`** — displays the crown/points leaderboard for Wordle or Connections
- **`/stats`** — shows per-player statistics (crowns, streak, avg. guesses, medals) for either game
- **`/graph`** — renders a stacked bar chart of crown wins per month
- **`/backfill`** — scans channel history and rebuilds the database from all past results
- **`/link-user`** — maps an unresolved Wordle name to a Discord user and merges their crowns
- **`/ping`** — returns bot and API latency

All game commands accept a `game` option (`wordle` or `connections`; defaults to `wordle`).

## Project Structure

```
sinebot/
├── data/
│   └── sinebot.db              # SQLite database (auto-created)
├── src/
│   ├── index.js                # entry point — boots the Discord client
│   ├── loader.js               # auto-loads all files in events/ and commands/
│   ├── deploy-commands.js      # one-time script to register slash commands
│   ├── connectionsSummary.js   # builds the daily Connections crown summary lines
│   ├── migrate-json-to-db.js   # one-time migration from the old crowns.json format
│   ├── commands/
│   │   ├── backfill.js         # /backfill history scan command
│   │   ├── crowns.js           # /crowns leaderboard command
│   │   ├── graph.js            # /graph crown-history chart command
│   │   ├── link-user.js        # /link-user alias command
│   │   ├── ping.js             # /ping latency command
│   │   └── stats.js            # /stats per-player statistics command
│   ├── events/
│   │   ├── ready.js            # fires once on login
│   │   ├── messageCreate.js    # routes Wordle/Connections messages to parsers
│   │   └── interactionCreate.js # routes slash command interactions
│   ├── utils/
│   │   ├── connectionsParser.js # parses Connections result grid messages
│   │   ├── connectionsScore.js  # Connections points math (base, penalties, streak)
│   │   ├── games.js            # shared game metadata and slash-command option helper
│   │   ├── leaderboard.js      # shared leaderboard formatting utilities
│   │   ├── messageParser.js    # extracts structured data from any message
│   │   ├── wordleDaily.js      # fetches the daily Wordle word and rates its commonality
│   │   └── wordleParser.js     # parses Wordle results messages
│   └── data/
│       ├── connectionsStore.js # read/write helpers for Connections results
│       ├── crownStore.js       # read/write helpers for Wordle results
│       └── db.js               # opens the SQLite database and bootstraps the schema
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
3. Writes the result to the database

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

### Backfilling history

When first deploying to a server with existing message history, run `/backfill` to scan the entire channel and build the database from scratch. The command reports how many messages were scanned and how many results were recorded.

```
/backfill
/backfill game:connections
```

The same command can be re-run at any time to rebuild from scratch — useful after adding new name aliases. Running it for one game does not affect the other.

## Connections Tracker

### How it works

The bot listens for messages in the configured Connections channel. When a player shares their result grid, it:

1. Parses the emoji grid to determine solve order, mistakes, slip mistakes, and whether the player solved it
2. Awards points based on performance (see scoring below)
3. Recomputes crown placement for that puzzle across all players who have submitted so far

Because results are self-shared at any time, placement is recalculated each time a new result arrives for a puzzle.

### Scoring

Each solved puzzle earns base points, with deductions for mistakes and bonuses for flair:

| Component | Points |
|---|---|
| Base | +100 |
| Regular mistake | −15 |
| Slip mistake (only two groups left) | −30 |
| Purple First (hardest group solved first) | +15 |
| Reverse Rainbow (solved hardest → easiest) | +30 |
| Streak bonus (per consecutive solved day) | +1/day |

A loss scores 0 points and breaks the streak. The crown goes to the player(s) with the highest daily score for that puzzle.

### Leaderboard

`/crowns game:connections` ranks players by total accumulated points. `/stats game:connections` shows per-player games, wins, average mistakes, streak, crowns, and special achievement counts (Purple Firsts and Reverse Rainbows).

## Database Schema

All data is stored in `data/sinebot.db` (SQLite). The schema is bootstrapped automatically on startup.

```
players            — one row per player per guild (Discord ID or name key)
name_aliases       — maps unresolved Wordle names to Discord user IDs
results            — one row per player per puzzle, for any game
processed_messages — deduplication log keyed by (guild, game, message_id)
```

Every table is guild-scoped, so the bot can serve multiple servers from a single process.

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
