# Scoring

## Wordle

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

## Connections

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

## Minute Cryptic

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

