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
- **`/graph`** — charts running crown and point totals over weekly/monthly
  buckets; head-to-head, top-N, trend lines and avatars
- **`/distribution`** — bell curve of any tracked metric, with a normal fit
- **`/correlation`** — group average vs. how many players share the crown
- **`/periods`** — the whole server's best and worst weekday, or month, charted
  against its own average
- **`/backfill`** — rebuilds a game's history from channel history (admin only)
- **`/link-user`** — maps an unresolved Wordle name to a Discord user (admin only)
- **`/unlinked`** — lists the names still holding results of their own, and what
  each is worth (admin only)
- **`/config`** — everything configurable: which channel each game is tracked in
  (admin only), and your own DM preferences (anyone)
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
    │   └── connections/         # self-report game
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
        ├── leaderboard.js       # leaderboard formatting
        └── permissions.js       # permission checks
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

See [DEPLOY.md](DEPLOY.md) for server prerequisites, the deploy pipeline, and
rollback.

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

Declaring `puzzleNumberFor` on a **self-report** game also enrols it in the daily
summary — its header and crown line are appended automatically when the
aggregate game posts. An aggregate game may declare it too, but only to name its
own puzzle; nothing is appended for it.

These optional fields wire a game into the analytics commands:

```js
  // What /distribution can plot. `valueOf` reads a getSeries() row, so no
  // store change is needed. Use `discrete` + min/max for a small integer range,
  // or `bins` for a continuous one.
  distributionMetrics: [
    { id: "hints", label: "Hints", discrete: true, min: 0, max: 3,
      valueOf: (row) => row.score },
  ],

  // What `score` counts, for /correlation's axis label.
  scoreLabel: "hints",

  // How a bucket of results is ranked when picking best and worst periods.
  // `direction` says which end of the metric is good; `axis` labels a chart.
  periodMetric: {
    by: "meanScore",
    direction: "lower",
    label: "avg. hints",
    axis: "Average hints",
    format: (b) => b.meanScore.toFixed(2),
  },

  // Extra /stats fields, shown unless `detail:false`. bestWorstFields()
  // renders the store's byWeekday/byMonth buckets against that same metric.
  detailFields: (s) => bestWorstFields(s, PERIOD_METRIC),
```

One `periodMetric`, two readers: `/stats` ranks one player's weekdays and months
on it, `/periods` ranks the whole server's on the same terms. Declare it once as
a module constant and hand it to both, as `src/games/wordle/index.js` does.

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
`/unlinked` lists the names currently in that state.

The name key is everything before the first `|`, lowercased, with Discord's
backslash escaping removed — so `@Luc | Graphic Design Lead` and
`@Luc || Graphic Design Lead` are one person, and stay one person when the role
changes. This matters more than it looks: a key that still carried the role
suffix minted a *new* player on every edit, quietly forking that person's
history and restarting their streak until an admin noticed.

The header is matched as `on an? (\d+) day streak`. The article is not
decoration — the upstream bot writes whichever one the number reads with, so a
pattern accepting only "a" discards every message whose streak begins 8, 11, 18
or 80–89, and with it that whole day's results.

**Current streak** counts back from the group's most recent posted puzzle, not
from the player's own last appearance, so a run that has already ended reads
zero rather than freezing at its final length. Days the upstream bot never
posted are stepped over: nobody could have played them, so they cost nobody
their streak. A failure still breaks it — the player was there and didn't
solve it.

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

## Charts

Every chart renders dark, to sit alongside Discord's embeds. The palette,
the single Chart.js canvas and the avatar plugin live in `src/charts/`; the
maths behind them is in `src/utils/stats.js`, which is pure and unit-tested.

Charts are drawn by node-canvas, which goes through Cairo, which cannot draw
colour emoji — an emoji in a display name comes out as an empty box. Every name
bound for a canvas therefore passes through `chartLabel` in
`src/charts/labels.js`, which strips emoji and falls back to the username when a
name is nothing else.

### `/graph`

Running totals over weekly or monthly buckets.

| Option | Effect |
|---|---|
| `metric` | Crowns or points, both as a running total (default: crowns) |
| `period`, `count` | Bucket size (default: weekly) and how many buckets |
| `user`, `vs` | Plot one player, or two head to head |
| `top` | Plot only the leading N |
| `trend` | Overlay a least-squares fit per player, with its equation and R² |
| `avatars` | Profile pictures past each line's last point (default on) |

Only cumulative metrics are offered. The per-bucket ones this used to carry —
crowns and points on their own, days played, average score — read as noise at
weekly resolution, and the running total is what a leaderboard chart is for.

`top` and `user`/`vs` are mutually exclusive. Avatars are fetched with a short
timeout and skipped on failure — a chart never fails because a picture didn't
load.

Trend equations are drawn in a panel inside the plot, top-left, where a chart of
running totals reliably has empty space. They used to hang off the legend
entries, which turned a row of names into a wall of algebra that grew with every
player. The legend now names players; the panel carries the maths, capped at
half the plot's height with a "+ N more not shown" line under it.

### `/distribution`

A histogram with the best-fitting normal curve over it, plus n, mean, median
and σ. Takes a `user` to narrow it from the whole server to one player.

### `/periods`

The server-wide half of the best/worst breakdown `/stats` shows for one player:
every player's results pooled into weekday or month buckets, ranked on that
game's own `periodMetric`.

| Option | Effect |
|---|---|
| `period` | Day of week or month (default: day of week) |
| `count` | How many recent months, 2 to 24 (default: 12); ignored for weekdays |

Columns are drawn as the **distance from the server's own average**, not as the
average itself. Plotted absolutely, the columns are near-flat — a good Wordle
weekday and a bad one are 3.4 guesses against 4.4 — and the question being asked
is which way off the usual a period ran, which is what a column measured from
the average shows directly. Each period's own average and result count sit under
its column, so the absolute figures are still there.

Colour marks only the two answers: the best column and the worst. Both are also
labelled on the chart and repeated in the message text, so neither depends on
telling green from red. A bucket too thin to rank — under 5 results for a
weekday, under 20 for a month, which keeps a three-day-old month from taking the
crown off a complete one — is drawn in grey and noted in the subtitle.

### `/correlation`

One point per day: the group's average that day against how many players tied
for the crown. Reports Pearson's r and a fitted line. Days with no recorded
crown are excluded and counted in the subtitle; repeated positions are drawn
larger rather than stacked invisibly.

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

## Tests

```bash
npm test
```

Uses the built-in `node:test` runner; there are no test dependencies. Suites
cover both parsers, the scoring rules, the shared self-report store (placement,
streaks, crowns, rebuilds, the statistical breakdowns), the aggregate store
(name-key normalisation across both suffix spellings, streak anchoring and
outage days, the unlinked listing), the statistics helpers
in `src/utils/stats.js`, message routing through the registry, chart-label
sanitising, and the Wordle daily announcement (including its puzzle numbering,
pinned against NYT's own `days_since_launch`).

Chart rendering itself is not unit-tested — the figures behind every chart are
covered instead, in `test/stats.test.js`.
