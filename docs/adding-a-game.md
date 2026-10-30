# Adding a Game

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
  // Optional: numbers that order players level on the rank key, most
  // significant first. Wordle declares [e.silver, e.bronze].
  // leaderboardTiebreak: (e) => [e.crowns],
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

## Adding a command or event

Drop a file in `src/commands/` or `src/events/`; both directories auto-load.
Commands export `{ data, execute }`, events export `{ name, once, execute }`.
Re-run `npm run deploy-commands` after adding a command.

