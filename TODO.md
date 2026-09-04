# TODO

## Done

- ~~Change the config and settings commands to one command with required
  parameters~~ — `/config` now carries `channel`, `disable`, `dm` and `show`;
  `/settings` is gone. Every parameter is required, with an explicit "All games"
  choice where `dm` used to infer one.
- ~~Emoji rendering in graph (Luc)~~ — Cairo cannot draw colour emoji, so names
  bound for a canvas are stripped by `chartLabel` (`src/charts/labels.js`)
  rather than drawn as empty boxes.
- ~~Change the default period to weeks in graph~~
- ~~Remove non-cumulative metrics, days played, average score (just cum. Crowns
  and Points) in graph~~ — and the bar/mean/ranking machinery they were the only
  users of.
- ~~Further document parameters to commands (metric in distribution)~~ —
  `/distribution`'s pooled metric choices are now named for the game that owns
  them ("Guesses (Wordle)"), and `/graph`'s options state their defaults and
  their mutual exclusions.
- ~~Remove Welcome message on entering server~~ — `guildCreate` only logs now.
- ~~Add Wordle header to daily announcement~~ — `🟩🟨⬛ Wordle #1899`, numbered
  locally so it survives an NYT outage.

## Open

- **Explain / overhaul the correlation graph — possibly remove.** Explained; the
  command is untouched for now. The four reasons the chart doesn't measure what
  it looks like it measures are written up under item 8 of `GRAPH_WANTS.md`.
  Decide there whether to fix the method (crown *share* instead of a raw count,
  failures scored as 7, Spearman instead of Pearson) or drop the command.

## Before this deploy reaches Discord

- `npm run deploy-commands` — command shapes changed, `/settings` was removed
  and `/periods` and `/unlinked` are new; none of it propagates until this is
  run from a workstation.
- `/backfill game:Wordle`, then `/unlinked` — recovers the 13 days the old
  header pattern discarded, and claims the old name spellings they arrive
  under. Full procedure in `DEPLOY.md`.
- Check the next daily Wordle post: the header's puzzle number should match the
  word on the line below it.
