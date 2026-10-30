# Semesters

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

## `/semester`

| Option | Effect |
|---|---|
| `which` | Current or previous semester (default: the one in progress) |
| `game` | One game in full (default: every game's champion) |

With no `game`, one line per registered game: that game's champion, on that
game's own measure — points for Connections and Minute Cryptic, crowns for
Wordle, with a crown tie broken on 🥈 and then 🥉 as on `/crowns`. Every
player still tied on top is a champion, the way tied crowns already share a day.

With a `game`, that game's semester in full — champion, standings, and three
figures that only make sense inside a bounded window:

- **Margin** — the gap to the best score that isn't the champion's (or "ahead
  on the tiebreak" when they were level on the measure itself), and how
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

