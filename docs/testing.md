# Tests

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
routing through the registry, chart-label sanitising, and the daily summary —
its podiums, leaderboard changes, streak endings, milestones, the Components V2
layout and its text cap, and Wordle's section (including its puzzle numbering,
pinned against NYT's own `days_since_launch`).

One of those is load-bearing beyond what it looks like: an unwindowed semester
board must render byte-for-byte identically to `/crowns`. That is what keeps the
fold in `src/utils/standings.js` honest if a store's leaderboard entry ever
changes shape.

Chart rendering itself is not unit-tested — the figures behind every chart are
covered instead, in `test/stats.test.js`.
