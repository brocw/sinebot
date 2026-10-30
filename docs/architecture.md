# Architecture

## Project Structure

```
sinebot/
├── data/sinebot.db              # SQLite database (auto-created, auto-migrated)
├── docs/                        # reference docs, indexed from the README
├── test/                        # node:test suites — no test dependencies
└── src/
    ├── index.js                 # entry point
    ├── loader.js                # auto-loads events/ and commands/
    ├── deploy-commands.js       # registers slash commands (global by default)
    ├── commands/                # one file per slash command
    ├── charts/
    │   ├── theme.js             # dark palette, shared by every chart
    │   ├── render.js            # the one Chart.js canvas
    │   ├── labels.js            # strips what the canvas cannot draw
    │   ├── avatarPlugin.js      # profile pictures on line endpoints
    │   ├── barLabelPlugin.js    # names the bars a chart is asking about
    │   └── trendPanel.js        # trend equations, drawn inside the plot
    ├── events/                  # one file per Discord event
    ├── games/
    │   ├── registry.js          # discovers and validates game modules
    │   ├── puzzleNumber.js      # daily-puzzle numbering + summary helpers
    │   ├── wordle/              # aggregate game
    │   ├── connections/         # self-report game
    │   └── minute-cryptic/      # self-report game
    ├── data/
    │   ├── db.js                # opens SQLite, runs migrations
    │   ├── migrations.js        # ordered, once-only schema migrations
    │   ├── selfReportStore.js   # shared store for self-report games
    │   ├── aggregateStore.js    # shared store for bot-posted games
    │   ├── guildConfigStore.js  # per-guild channel routing
    │   └── userPrefsStore.js    # global per-user DM preferences
    └── utils/
        ├── stats.js             # mean/median/stdev, regression, histograms
        ├── statFields.js        # best/worst embed fields
        ├── periods.js           # best/worst buckets pooled across the server
        ├── semesters.js         # the academic calendar, as windows over results
        ├── standings.js         # leaderboards folded over a window of time
        ├── leaderboard.js       # leaderboard formatting
        └── permissions.js       # permission checks
```

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

`/backfill`, `/link-user`, `/unlinked` and `/config channel`/`disable` require
the **Manage Server** permission, or the user ID in `OWNER_ID`. `/config dm` and
`/config show` are open to everyone — they change or report only the caller's
own preferences, plus which channels are already visibly being watched.

The check is at runtime rather than via Discord's
`setDefaultMemberPermissions`, because the latter is enforced per-guild and would
lock the owner out of servers where they aren't an admin.

`/backfill` is destructive — it deletes a game's recorded results before
rebuilding — so it asks for confirmation first.

