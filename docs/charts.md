# Charts

Every chart renders dark, to sit alongside Discord's embeds. The palette,
the single Chart.js canvas and the avatar plugin live in `src/charts/`; the
maths behind them is in `src/utils/stats.js`, which is pure and unit-tested.

Charts are drawn by node-canvas, which goes through Cairo, which cannot draw
colour emoji — an emoji in a display name comes out as an empty box. Every name
bound for a canvas therefore passes through `chartLabel` in
`src/charts/labels.js`, which strips emoji and falls back to the username when a
name is nothing else.

Every chart command also works in a DM with the bot, reading the results of the
server named by its `server` option — or, when the caller shares only one server
with the bot, that one. Membership is checked each time; see
`src/utils/guildContext.js`. A `/graph` drawn from a DM carries its server's name
in the subtitle, since nothing else around it says where it came from.

## `/graph`

Running totals over weekly or monthly buckets.

| Option | Effect |
|---|---|
| `metric` | Crowns or points, both as a running total (default: crowns) |
| `period`, `count` | Bucket size (default: weekly) and how many buckets |
| `user`, `vs` | Plot one player, or two head to head |
| `top` | Plot only the leading N |
| `trend` | Overlay a least-squares fit per player, with its equation and R² |
| `avatars` | Profile pictures past each line's last point (default on) |
| `private` | Reply only to the caller rather than the channel (default off) |

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

## `/distribution`

A histogram with the best-fitting normal curve over it, plus n, mean, median
and σ. Takes a `user` to narrow it from the whole server to one player.

## `/periods`

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

## `/correlation`

One point per day: the group's average that day against how many players tied
for the crown. Reports Pearson's r and a fitted line. Days with no recorded
crown are excluded and counted in the subtitle; repeated positions are drawn
larger rather than stacked invisibly.

