# Graph & statistics wants

Status of the original list. ✅ shipped, ⏸️ deferred (with the reason).

1. ✅ **Approx equation of a line plotted for a user's cumulative crowns**
   `/graph trend:true` fits a least-squares line per plotted player and puts
   `y = mx + c (R² …)` in the legend. Works on any metric, not just cumulative
   crowns; bar charts unstack so the line stays visible.

2. ✅ **Head to head (or top k) as additional parameters for graph**
   `/graph user:@a vs:@b` for head to head, `/graph top:5` for the best N.
   `top` ranks on the selected metric, so "top 5" by average score means the
   five *lowest* averages.

3. ⏸️ **'Best' and 'Worst' periods, days, hours (personal stats)**
   Periods and days shipped: `/stats detail:true` shows the best and worst
   weekday and month, ranked on each game's own measure (fewest guesses for
   Wordle, most points for Connections), ignoring buckets under 3 plays.

   **Hours are deferred.** Every Wordle row carries the upstream bot's post
   timestamp, so all players on a given day share one `ts` — an hour-of-day
   breakdown would describe when the bot posted, not when anyone played.
   Weekday and month are unaffected, since the bot posts once a day.

   To pick this up later: the Wordle bot posts in-progress results as they
   happen, so the real per-player times are visible in the channel. It needs a
   column on `results` for the player's own time (distinct from the aggregate
   message's `ts`), the message handler updated to record it, and a backfill to
   populate history. Once that exists, `timeBreakdown` in `src/utils/stats.js`
   takes a `tsOf` accessor already — an hours bucket is a small addition.

4. ✅ **Dark mode toggle, more colors**
   Every chart renders dark; there is no light mode to toggle between. The
   palette went from 10 colours to 20, all picked for contrast on a dark
   background — the old greys and tans washed out. See `src/charts/theme.js`.

5. ✅ **Profile pictures to the right of the last 'node' in the graph**
   `/graph avatars:true` (the default on line charts). Circular, ringed in the
   line's colour. Skipped for unresolved Wordle names, players who left the
   server, and any avatar that fails to load.

6. ✅ **Bell curve graph style**
   `/distribution` — histogram plus the best-fitting normal curve, with n, mean,
   median and σ in the subtitle.

7. ✅ **Median guesses, standard deviation**
   In `/stats`, folded into the existing average field, and in every
   `/distribution` subtitle. Computed over solved days only, matching how the
   average already excluded losses.

8. ✅ **Relationship between average guesses for the group that day and number
   of people tied for the crown that day**
   `/correlation` — a scatter of one point per day with Pearson's r and a
   fitted line. Repeated positions are drawn larger rather than stacked
   invisibly.

9. ⏸️ **Before and after sinebot graph, statistics**
   Tabled — `/graph`'s `period` and `count` already narrow the window enough to
   see the difference by eye.

10. ✅ **Average connections score**
    `/stats game:Connections` now shows average points per day. Averaged over
    every day played, counting a loss as the 0 it scores — unlike average
    mistakes, which has nothing to average on a loss and so excludes them.
