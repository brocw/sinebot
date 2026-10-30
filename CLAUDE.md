# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

SINEBOT is a Discord bot (discord.js v14, ESM, Node >= 22.5) that tracks daily puzzle games — Wordle, Connections, Minute Cryptic — per guild, with leaderboards, stats and Chart.js charts. `README.md` covers setup; `docs/` is detailed and authoritative on scoring rules, command options and design rationale (indexed at the bottom of the README); `DEPLOY.md` covers deployment and rollback.

## Commands

```bash
npm test                                   # all suites (node:test, no test deps)
node --test test/semesters.test.js         # a single suite
node --test --test-name-pattern="streak" 'test/*.test.js'   # tests matching a name
npm run dev                                # run with --watch (needs .env)
npm run deploy-commands                    # register slash commands globally
npm run deploy-commands -- --guild         # register to GUILD_ID instantly (dev)
npm run deploy-commands -- --clear-guild   # remove guild set (else commands show twice)
```

There is no linter or build step. Pushing to `main` runs tests in CI and auto-deploys to a DigitalOcean droplet (pm2). The deploy job also runs `npm run deploy-commands` on the droplet after the pm2 restart, so global slash-command registration (including the `game` choices generated from the registry) is automatic. Guild-scoped registration (`--guild` / `--clear-guild`) stays manual.

## Architecture

**Game registry is the central abstraction.** `src/games/registry.js` imports every `src/games/<id>/index.js` at startup (top-level await) and validates required fields. Commands, message routing, `/backfill` and the daily summary all iterate `GAMES` / use `gameOption`/`gameFrom` — adding a game must not require editing any command or event file. The directory name must equal the game's `id`.

**Two game kinds**, each with a shared store factory in `src/data/`:
- `self-report` (Connections, Minute Cryptic): each player posts their own result. `createSelfReportStore(id, { basePoints, dailyScore, scoreOf, detailsOf })` handles dedup, placement, crowns, streaks, leaderboards and stats. Placement is recomputed as late/backfilled results arrive, including for later puzzles (streaks extend forward). Game supplies `parse` + `formatDm`.
- `aggregate` (Wordle): an upstream bot posts everyone's scores in one message. Uses `createAggregateStore`; its upstream message triggers the daily summary. Unresolved players are stored under a normalised name key until `/link-user` maps them.

**Message flow** (`src/events/messageCreate.js`): for each game, `wantsMessage` → channel matches `trackedChannel(guild, game)` → `parse`; first game to parse claims the message. When the aggregate game fires, it posts a combined daily summary (`src/summary/`) as a silent Components V2 message: a card per game (the aggregate game plus every tracked self-report game declaring `puzzleNumberFor`), a gold card for each leaderboard dethroning, and a highlights card. Everything in it is folded from `getSeries()` rows; games dress their card through the optional `daily` and `resultLabel` hooks.

**Optional game hooks drive analytics** — `distributionMetrics`, `scoreLabel`, `periodMetric`, `detailFields`, `leaderboard*`, `statFields`, `puzzleLabel`. `periodMetric` is read by `/stats`, `/periods` and `/semester`'s "most improved"; declare it once as a module constant (see `src/games/wordle/index.js`). See `docs/adding-a-game.md` for the full shape.

**Derived views compute from series rows, not new tables.** `/semester` folds `store.getSeries()` rows through `src/utils/standings.js` into the same entry shape `getLeaderboard()` produces, so it renders via each game's existing `leaderboardLine`/`leaderboardRankKey`. `test/standings.test.js` requires an unwindowed fold to render byte-for-byte identical to `/crowns` — keep that passing if a store's leaderboard entry changes shape. Semester boundaries live in `src/utils/semesters.js` and are read in `America/New_York`, not host time.

**Commands/events** auto-load from `src/commands/` (`{ data, execute }`) and `src/events/` (`{ name, once, execute }`) via `src/loader.js`. Admin checks are done at runtime in `src/utils/permissions.js` (Manage Server or `OWNER_ID`), deliberately not via `setDefaultMemberPermissions`.

**Database**: `node:sqlite` (`DatabaseSync`), opened at **import time** in `src/data/db.js` at `$DATA_DIR/sinebot.db`. Migrations are numbered entries in `src/data/migrations.js`, applied once on startup — add a new entry; never edit one that has shipped. Use `tx()` for transactions (nesting-safe).

**Charts** render via chartjs-node-canvas (Cairo), which can't draw colour emoji — any name going onto a canvas must pass through `chartLabel` in `src/charts/labels.js`. Chart rendering isn't unit-tested; the maths in `src/utils/stats.js` is.

## Testing conventions

- Tests that touch the DB must set `process.env.DATA_DIR = mkdtempSync(...)` **before** dynamically importing any `src/data` module (`await import(...)`), since `db.js` opens the file on import. Follow the pattern at the top of `test/selfReportStore.test.js`.
- `test/helpers.js` provides a minimal fake `Message` (`msg()`) and Connections grid builders — parsers only read `content`/`author`, so no gateway is needed.

## Project notes

- The running version (`package.json` `version` + short commit, via `src/version.js`) is shown by `/ping` and the startup log; bump rules are in `DEPLOY.md` → Versioning.
- **Bump the version as part of any user-visible change, without being asked**: patch for fixes, wording and behaviour tweaks (e.g. leaderboard ordering); minor for a new game, command, chart or migration; major only for breaking changes to stored data or commands. Use `npm version <patch|minor|major> --no-git-tag-version` so `package-lock.json` stays in step. Bump once per branch/PR — compare against `main` (`git diff main -- package.json`) and don't bump again if the branch already has; raise it to minor if a later change warrants it. Docs-, test- or CI-only changes need no bump.
- `TODO.md` tracks open work and pending manual deploy steps; `docs/GRAPH_WANTS.md` records the status and reasoning behind chart/stat features (e.g. why hour-of-day is deferred, the open question on `/correlation`).
- Parser regressions have silently dropped whole days before (Wordle's `on an? (\d+) day streak` article bug) — a parser returning `null` discards the entire message with no log, so be conservative when tightening patterns.
