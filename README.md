# SINEBOT

A daily game tracker for Discord. Ships with Wordle and Connections, and is
built so additional daily games drop in as self-contained modules.

## Features

- **Game registry** — each game is one directory under `src/games/`; adding one
  registers it across every command automatically
- **Multi-server** — per-guild, per-game channel configuration; one process
  serves many servers
- **`/crowns`** — leaderboard for any registered game
- **`/stats`** — per-player statistics
- **`/graph`** — charts crowns, points, cumulative totals or averages over
  weekly/monthly buckets
- **`/backfill`** — rebuilds a game's history from channel history (admin only)
- **`/link-user`** — maps an unresolved Wordle name to a Discord user (admin only)
- **`/config`** — sets which channel each game is tracked in (admin only)
- **`/settings`** — per-user DM preferences, global across servers
- **`/ping`** — bot and API latency

## Project Structure

```
sinebot/
├── data/sinebot.db              # SQLite database (auto-created, auto-migrated)
├── test/                        # node:test suites — no test dependencies
└── src/
    ├── index.js                 # entry point
    ├── loader.js                # auto-loads events/ and commands/
    ├── deploy-commands.js       # registers slash commands (global by default)
    ├── commands/                # one file per slash command
    ├── events/                  # one file per Discord event
    ├── games/
    │   ├── registry.js          # discovers and validates game modules
    │   ├── puzzleNumber.js      # daily-puzzle numbering + summary helpers
    │   ├── wordle/              # aggregate game
    │   └── connections/         # self-report game
    ├── data/
    │   ├── db.js                # opens SQLite, runs migrations
    │   ├── migrations.js        # ordered, once-only schema migrations
    │   ├── selfReportStore.js   # shared store for self-report games
    │   ├── aggregateStore.js    # shared store for bot-posted games
    │   ├── guildConfigStore.js  # per-guild channel routing
    │   └── userPrefsStore.js    # global per-user DM preferences
    └── utils/                   # leaderboard formatting, permission checks
```

## Setup

```bash
npm install
cp .env.example .env    # then fill it in
npm run deploy-commands
npm start
```

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | yes | Bot token from the Developer Portal |
| `CLIENT_ID` | yes | Application ID |
| `OWNER_ID` | no | Bot owner; may run admin commands in any guild |
| `GUILD_ID` | no | Only needed for `npm run deploy-commands -- --guild` |
| `WORDLE_CHANNEL_ID` | no | Legacy fallback for guilds with no `/config` row yet |
| `DATA_DIR` | no | Overrides the database location (used by tests) |

Slash commands register **globally** by default, so every server the bot joins
picks them up (Discord may take up to an hour to propagate). During development,
`npm run deploy-commands -- --guild` registers to `GUILD_ID` instantly instead.

### Per-server configuration

Nothing is tracked until an admin points each game at a channel:

```
/config channel game:Connections channel:#puzzles
/config show
/backfill game:Connections
```

## Adding a Game

Create `src/games/<id>/index.js`. The registry picks it up on next start and it
appears in every command's `game` option automatically — no command or event
file needs editing.

Most daily games are **self-report** (each player posts their own result). For
those, the shared store handles dedup, placement, crowns, streaks, leaderboards
and stats, so a new game supplies only a parser and a scoring spec:

```js
import { createSelfReportStore } from "../../data/selfReportStore.js";
import { makePuzzleNumbering } from "../puzzleNumber.js";
import { parseStrandsResult } from "./parser.js";

const store = createSelfReportStore("strands", {
  basePoints: (p) => (p.solved ? 100 - p.hints * 10 : 0),
  dailyScore: (base, streak) => (base > 0 ? base + streak : 0),
  scoreOf: (p) => (p.solved ? p.hints : null), // null means "did not solve"
  detailsOf: (p) => ({ hints: p.hints }),      // stored as JSON for stats
});

export default {
  id: "strands",              // must match the directory name
  label: "Strands",
  emoji: "🔵🟡",
  color: 0x4b9cd3,
  kind: "self-report",
  hasPoints: true,
  store,
  puzzleNumberFor: makePuzzleNumbering({ anchorUTC: Date.UTC(2024, 2, 4) }),

  wantsMessage: (message) => !message.author.bot,
  parse: parseStrandsResult,

  formatDm: (parsed, score) => `Solved #${parsed.puzzle} for ${score.total}!`,

  leaderboardTitle: "Points Leaderboard",
  leaderboardFilter: (e) => e.games > 0,
  leaderboardEmpty: "No Strands results recorded yet.",
  leaderboardRankKey: (e) => e.totalPoints,
  leaderboardLine: (rank, e) => `${rank}. <@${e.uid}>: 🏅 ${e.totalPoints}`,
  leaderboardSummary: (entries) => ({
    name: "🏅 Total",
    value: `${entries.reduce((a, e) => a + e.totalPoints, 0)}`,
  }),

  statFields: (s) => [
    { name: "🏅 Points", value: `${s.totalPoints}`, inline: true },
    { name: "📆 Days played", value: `${s.games}`, inline: true },
  ],
};
```

Declaring `puzzleNumberFor` also enrols the game in the daily summary — its
crown line is appended automatically when the aggregate game posts.

The other shape is **aggregate**: one upstream bot posts everyone's scores in a
single message (this is how Wordle works). Those use `createAggregateStore` and
supply an `announce()` method instead of `formatDm`. See `src/games/wordle/`.

### Adding a command or event

Drop a file in `src/commands/` or `src/events/`; both directories auto-load.
Commands export `{ data, execute }`, events export `{ name, once, execute }`.
Re-run `npm run deploy-commands` after adding a command.

## Scoring

### Wordle

The upstream Wordle bot posts one message listing every player's score. The bot
parses the `👑` line, awards a crown to each player on it, and records the rest
by placement. Players the upstream bot could not resolve appear as `@Name` and
are stored under a normalised name key until `/link-user` maps them.

### Connections

Each player posts their own grid. Points are awarded per puzzle:

| Component | Points |
|---|---|
| Base | +100 |
| Regular mistake | −15 |
| Slip mistake (only two groups left) | −30 |
| Purple First | +15 |
| Reverse Rainbow | +30 |
| Streak bonus | +1 per consecutive solved day |

A loss scores 0 and breaks the streak. The crown goes to the highest daily score
for that puzzle; ties share it. Because results arrive at any time, placement is
recomputed as new results land — including for later puzzles, since a
back-filled result extends a streak forward.

## Database

SQLite at `data/sinebot.db`. Schema changes go in `src/data/migrations.js` as a
new numbered entry; they run once each on startup and are recorded in
`schema_version`. Never edit a migration that has shipped.

```
players             — one row per player per guild
name_aliases        — maps unresolved Wordle names to Discord user IDs
results             — one row per player per puzzle, for any game
processed_messages  — deduplication log
guild_config        — per-guild, per-game tracked channel
user_prefs          — per-user DM preferences (global, not guild-scoped)
schema_version      — applied migration ledger
```

## Permissions

`/backfill`, `/link-user` and `/config` require the **Manage Server** permission,
or the user ID in `OWNER_ID`. The check is at runtime rather than via Discord's
`setDefaultMemberPermissions`, because the latter is enforced per-guild and would
lock the owner out of servers where they aren't an admin.

`/backfill` is destructive — it deletes a game's recorded results before
rebuilding — so it asks for confirmation first.

## Tests

```bash
npm test
```

Uses the built-in `node:test` runner; there are no test dependencies. Suites
cover both parsers, the scoring rules, the shared self-report store (placement,
streaks, crowns, rebuilds) and message routing through the registry.
