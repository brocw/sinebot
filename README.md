# SINEBOT

A daily game tracker for Discord. Ships with Wordle, Connections and Minute
Cryptic, and is built so additional daily games drop in as self-contained
modules.

## Features

- **Game registry** — each game is one directory under `src/games/`; adding one
  registers it across every command automatically
- **Multi-server** — per-guild, per-game channel configuration; one process
  serves many servers
- **`/crowns`** — leaderboard for any registered game
- **`/stats`** — per-player statistics
- **`/graph`** — charts running crown and point totals over weekly/monthly
  buckets; head-to-head, top-N, trend lines and avatars
- **`/distribution`** — bell curve of any tracked metric, with a normal fit
- **`/correlation`** — group average vs. how many players share the crown
- **`/periods`** — the whole server's best and worst weekday, or month, charted
  against its own average
- **`/semester`** — champions, standings and turnout for an academic semester
- **`/backfill`** — rebuilds a game's history from channel history (admin only)
- **`/link-user`** — maps an unresolved Wordle name to a Discord user (admin only)
- **`/unlinked`** — lists the names still holding results of their own, and what
  each is worth (admin only)
- **`/config`** — everything configurable: which channel each game is tracked in
  (admin only), and your own DM preferences (anyone)
- **`/ping`** — bot and API latency
- **Works in DMs** — every read-only command (`/graph`, `/stats`, `/crowns`,
  `/distribution`, `/correlation`, `/periods`, `/semester`, `/ping`) can be run
  in a DM with the bot, so charts don't land in a server channel; a `server`
  option picks which server's results when you share more than one. In a server,
  `/graph private:True` shows the chart to you alone

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
picks them up (Discord may take up to an hour to propagate). Every deploy to
`main` re-registers them, so the manual run is only needed locally. During development,
`npm run deploy-commands -- --guild` registers to `GUILD_ID` instantly instead.

Guild and global registrations are separate sets and Discord offers a guild
both, so anything left in the guild set shows up **twice** in that server's
picker. `npm run deploy-commands -- --clear-guild` empties it; the global set is
untouched.

See [DEPLOY.md](DEPLOY.md) for server prerequisites, the deploy pipeline, and
rollback.

### Per-server configuration

Nothing is tracked until an admin points each game at a channel:

```
/config channel game:Connections channel:#puzzles
/config show
/backfill game:Connections
```

## Adding a game, command or event

Each game is one directory under `src/games/`, and the registry wires it into
every command automatically. Commands and events auto-load from
`src/commands/` and `src/events/`. See
[docs/adding-a-game.md](docs/adding-a-game.md).

## Tests

```bash
npm test
```

Uses the built-in `node:test` runner; there are no test dependencies. See
[docs/testing.md](docs/testing.md) for what the suites cover.

## Documentation

| Doc | Covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Project structure, database schema and migrations, permissions |
| [docs/adding-a-game.md](docs/adding-a-game.md) | The game module contract, store factories, analytics hooks |
| [docs/scoring.md](docs/scoring.md) | How Wordle, Connections and Minute Cryptic are scored, crowned and streaked |
| [docs/semesters.md](docs/semesters.md) | The academic calendar and `/semester` |
| [docs/charts.md](docs/charts.md) | `/graph`, `/distribution`, `/periods`, `/correlation` |
| [docs/GRAPH_WANTS.md](docs/GRAPH_WANTS.md) | Status and reasoning behind requested chart and stat features |
| [docs/testing.md](docs/testing.md) | What the test suites cover |
| [DEPLOY.md](DEPLOY.md) | Server prerequisites, deploy pipeline, rollback |
