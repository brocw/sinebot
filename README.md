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

The store keys dedup and streaks on a number that advances one per calendar day,
so a game whose share carries only a date has to mint one. Anchor the numbering
before the game existed, and add `puzzleLabel` so the invented ordinal is never
shown — the summary names the puzzle with whatever it returns instead of `#123`.
`src/games/minute-cryptic/puzzle.js` does both.

These optional fields wire a game into the analytics commands:

```js
  // What /distribution can plot. `valueOf` reads a getSeries() row, so no
  // store change is needed. Use `discrete` + min/max for a small integer range,
  // or `bins` for a continuous one; leave a bound off and it follows the data.
  // A self-report row also carries that game's own decoded `details`, so a
  // metric can plot something the shared columns don't hold.
  distributionMetrics: [
    { id: "hints", label: "Hints", discrete: true, min: 0, max: 3,
      valueOf: (row) => row.score },
    { id: "par-delta", label: "Hints vs. par", discrete: true,
      valueOf: (row) => row.details?.parDelta },
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

### Minute Cryptic

Each player posts their own share. The share carries a date rather than a puzzle
number — the site publishes none — so the number the store keys on is this bot's
own, days since 1 January 2022, and is never shown: `/stats`, the result DM and
the daily summary all name the puzzle by its date.

Hints are the headline metric, but they are not what scores. A raw hint count is
not comparable between days: a player who took three hints on a puzzle the world
needed seven for did better than one who took two on a giveaway. Minute Cryptic
publishes its own difficulty measure — the community par — so points are scored
on the distance from it:

| Component | Points |
|---|---|
| Base | +100 |
| Per hint under the community par | +12 |
| Per hint over the community par | −12 |
| Solved with no hints at all | +20 |
| Streak bonus | +1 per consecutive day played |

Points floor at 0, and a share posted before the puzzle has a community par
scores the base alone rather than being dropped. The crown goes to the highest
daily score; ties share it. Within one day everyone faces the same par, so that
is the same ranking as fewest hints — the par adjustment only matters once days
are added together.

There is no losing state: the puzzle feeds out hints until the answer falls, so
every share is a solve. A **streak** here is therefore consecutive days *played*,
which is what the game's own streak counts, and a day bad enough to floor the
score at 0 still extends it. Missing a day is the only thing that breaks it.

`/stats` reports the split that follows from all this: average hints, average
distance from par, how many days landed under, on and over it, hintless solves,
and a median solve time over the days whose share carried one.

## Semesters

`/crowns` credits everyone who ever played. On a server with an intake every
August that makes the all-time board largely a record of who arrived first, and
a newcomer can never catch up. A semester is short enough that they can.

UCF's calendar, day-precise:

| Semester | Runs |
|---|---|
| Spring | 1 Jan – 5 May |
| Summer | 6 May – 23 Aug |
| Fall | 24 Aug – 31 Dec |

The whole calendar is one constant in `src/utils/semesters.js`. Days are read in
`America/New_York`, not in the deploy box's zone: `monthKey` reads local time and
nothing sets `TZ` on the server, so on a UTC host a result posted at 8pm ET on
5 May would land in Summer — the wrong side of a boundary the calendar states to
the day.

Nothing is stored. Every figure is folded out of `store.getSeries()` rows
filtered to the window, so there is no migration, no table to keep in sync, and
a `/backfill` corrects semester history the moment it corrects everything else.
Semester points are the scores earned on the days inside the window — a streak
running into a semester still pays, because the player did earn it that day.

### `/semester`

| Option | Effect |
|---|---|
| `which` | Current or previous semester (default: the one in progress) |
| `game` | One game in full (default: every game's champion) |

With no `game`, one line per registered game: that game's champion, on that
game's own measure — points for Connections and Minute Cryptic, crowns for
Wordle. Every player tied on top is a champion, the way tied crowns already
share a day.

With a `game`, that game's semester in full — champion, standings, and three
figures that only make sense inside a bounded window:

- **Margin** — the gap to the best score that isn't the champion's, and how
  often the lead changed hands. A tie that still includes the standing leader is
  not a change: they haven't lost it.
- **Turnout** — days played over days *anybody* played. The denominator is not
  the length of the semester: a day nobody played is a day the game didn't run
  here, and it is not held against anyone. That is the rule Wordle streaks
  already follow.
- **Most improved** — each player's own previous semester against this one, on
  the game's `periodMetric`, needing 5+ days in both. Compared as a **per-day
  average, not a total**: the semesters are 110 to 130 days long and people play
  different amounts of them, so totals would mostly measure who was around more.
  `periodMetric` is already each game's declaration of which average matters and
  which end of it is good, so this reads that rather than inventing a second
  ranking rule.

A semester board is built by folding series rows into the same entry shape
`getLeaderboard()` produces, so it renders through the `leaderboardLine` /
`leaderboardRankKey` hooks each game already declares — a new game gets
`/semester` for free, like every other command. `test/standings.test.js` pins
that down: an unwindowed fold has to render byte-for-byte identically to the
all-time board.

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
cover every parser, the scoring rules, the shared self-report store (placement,
streaks, crowns, rebuilds, the statistical breakdowns), the aggregate store
(name-key normalisation across both suffix spellings, streak anchoring and
outage days, the unlinked listing), the statistics helpers
in `src/utils/stats.js`, the semester calendar (both sides of every boundary,
and that the day is read in Eastern time), the windowed standings fold, message
routing through the registry, chart-label sanitising, and the Wordle daily
announcement (including its puzzle numbering, pinned against NYT's own
`days_since_launch`).

One of those is load-bearing beyond what it looks like: an unwindowed semester
board must render byte-for-byte identically to `/crowns`. That is what keeps the
fold in `src/utils/standings.js` honest if a store's leaderboard entry ever
changes shape.

Chart rendering itself is not unit-tested — the figures behind every chart are
covered instead, in `test/stats.test.js`.
