# Deploying SINEBOT

Deploys are automatic: pushing to `main` runs the test suite, then deploys to the
DigitalOcean droplet over SSH via `.github/workflows/deploy.yml`. That workflow
snapshots the database, pulls, installs, and restarts pm2.

Two things are **not** automated and must be done by hand:

- **Registering slash commands** (`npm run deploy-commands`) — run from a
  workstation, whenever a command's name, description or options change, or one
  is added or removed. Registration replaces the whole set, so a deleted command
  disappears from the picker on its own.
- **Per-server setup in Discord** (`/config`) — once per guild.

---

## Routine deploy

1. Merge to `main`. CI runs `npm test` and blocks the deploy if it fails.
2. Watch the bot come back up:

   ```bash
   pm2 logs sinebot --lines 50
   ```

   Expect any pending `[db] applied migration …` lines, then
   `Logged in as … serving N guild(s), tracking N game(s)`.

3. If you changed a slash command's shape, re-register from your workstation:

   ```bash
   npm run deploy-commands
   ```

   Global registration can take up to an hour to propagate. For fast iteration
   against a single test server, `npm run deploy-commands -- --guild` registers
   to `GUILD_ID` instantly instead.

   **Clean up after `--guild`.** Guild and global registrations are independent
   sets, and Discord offers a guild both — so every command left in the guild
   set appears **twice** in that server's picker. Re-running the global deploy
   does not fix it, because it never touches the guild set. Empty it with:

   ```bash
   npm run deploy-commands -- --clear-guild
   ```

   That clears only `GUILD_ID`'s commands and reports how many global ones
   remain, so you can see you are not left with nothing. It takes effect
   immediately.

### Database backups

Each deploy writes a snapshot to `data/backups/` before pulling and keeps the
fourteen most recent. This requires `sqlite3` on the droplet's `PATH`; the step
runs under `set -e`, so a missing binary aborts the deploy.

Migrations run on startup and are one-way. The snapshot is the rollback point.

---

## One-time: recovering the dropped Wordle days

Only relevant when upgrading a deployment that ran the old header pattern.
Skip this on a fresh install.

`parseWordleResult` matched `on a (\d+) day streak` and returned `null` for
anything else — and a `null` there discards the entire message. The upstream
bot writes whichever article the number reads with, so every day whose group
streak began 8, 11, 18 or 80–89 was thrown away silently: no error, no log
line, just a day with no results. In the production database that cost 13 days,
including ten consecutive ones while the streak ran 80 through 89, which read
back as a fortnight-long outage that never happened.

The fix is in the parser, but it only applies to messages processed *after* it
ships. Recovering the lost days needs a re-read of channel history.

### 1. Deploy and confirm the migration ran

```bash
pm2 logs sinebot --lines 50
```

Expect `[db] applied migration 5: collapse name keys onto a single-pipe role
separator`. It rewrites `name_aliases` so the corrected name-key rule still
finds everyone — without it, an alias stored under a role suffix (`name:jack b
| sponsor/outreach lead`) stops matching and that player's results strand on a
fresh unlinked row. The deploy's own snapshot in `data/backups/` is the
rollback point.

### 2. Re-register commands

`/unlinked` is new, so from a workstation:

```bash
npm run deploy-commands
```

### 3. Backfill Wordle

```
/backfill game:Wordle
```

Destructive and slow — it deletes the game's results and pages the full channel
history. One game at a time.

### 4. Claim whatever the backfill surfaces

```
/unlinked
```

The recovered messages are old enough to carry name spellings nothing is
mapped to yet — `@Finn R` where the alias says `name:finn radner`, `@Keanu B`
where it says `name:keanu b.`. Those arrive as unlinked players holding their
own crowns. `/unlinked` lists them with a result count and a date range; map
each one:

```
/link-user name:Finn R user:@finn
```

Re-run `/unlinked` until it comes back empty, then sanity-check with `/crowns`
and `/stats`.

---

## Server prerequisites

| Requirement | Check | Why |
|---|---|---|
| Node >= 22.5 | `node --version` | `node:sqlite` does not exist before it; the bot crashes on boot |
| `sqlite3` CLI | `which sqlite3` | The backup step aborts the deploy without it |
| pm2 | `pm2 list` | Process manager the workflow restarts |

Install `sqlite3` with `sudo apt install -y sqlite3`.

### Environment

The droplet's `.env` needs:

| Variable | Required | Notes |
|---|---|---|
| `DISCORD_TOKEN` | yes | |
| `CLIENT_ID` | yes | |
| `OWNER_ID` | recommended | May run admin commands in any guild |
| `GUILD_ID` | no | Only for `deploy-commands -- --guild` |
| `WORDLE_CHANNEL_ID` | no | Legacy fallback; see below |
| `DATA_DIR` | no | Overrides the database location |

### GitHub secrets

`DO_HOST`, `DO_USER`, `DO_SSH_KEY`, `DO_DEPLOY_PATH`.

---

## Adding the bot to a new server

Nothing is tracked until an admin points each game at a channel:

```
/config channel game:Wordle      channel:#puzzles
/config channel game:Connections channel:#puzzles
/config show
```

Several games can share one channel. Then import history:

```
/backfill game:Wordle
/backfill game:Connections
```

`/backfill` deletes that game's recorded results before rebuilding, so it asks
for confirmation. Run one game at a time — each pages the full channel history.

`/config channel`, `/config disable`, `/backfill` and `/link-user` require
**Manage Server**, or the user ID in `OWNER_ID`. `/config dm` and `/config show`
are open to everyone.

---

## One-time migration: env-var config → registry build

Only relevant when upgrading a deployment that predates the game registry.
Skip this on a fresh install.

### 1. Before merging

Verify the [server prerequisites](#server-prerequisites) above — particularly
Node >= 22.5 and `sqlite3`. Then add the owner ID:

```bash
cd "$DEPLOY_PATH"
echo 'OWNER_ID=955299747885903903' >> .env
```

Keep `WORDLE_CHANNEL_ID` for now. It is the fallback that keeps the existing
server working in the window between deploying and running `/config`.

### 2. Take a manual backup

The workflow backs up on every deploy, but not before this first one:

```bash
mkdir -p data/backups
sqlite3 data/sinebot.db ".backup 'data/backups/pre-registry-$(date +%Y%m%d).db'"
```

### 3. Merge and watch the migrations

```bash
pm2 logs sinebot --lines 50
```

Expect four `[db] applied migration …` lines.

### 4. Re-register commands, then clear the old guild-scoped ones

From a workstation:

```bash
npm run deploy-commands
```

Commands were previously registered per-guild. Those registrations persist
independently of the new global ones, so every command appears **twice** in the
picker until the old set is cleared:

```bash
npm run deploy-commands -- --clear-guild
```

Run this *after* `deploy-commands`, so you are never left with no commands —
the flag prints the surviving global count, and warns if that count is zero.

### 5. Configure and backfill

Follow [Adding the bot to a new server](#adding-the-bot-to-a-new-server), then
sanity-check with `/crowns`, `/stats`, and
`/graph metric:Crowns period:Monthly`.

### 6. Drop the fallback

Once `/config show` looks right:

```bash
sed -i '/^WORDLE_CHANNEL_ID=/d' .env && pm2 restart sinebot
```

Keep `GUILD_ID` — it is still used by `deploy-commands -- --guild`.

---

## Rollback

```bash
pm2 stop sinebot
cp data/backups/<snapshot>.db data/sinebot.db
git checkout <previous-commit>
npm ci --omit=dev
pm2 start sinebot
```

Restore the database as well as the code. An older build cannot read a migrated
schema — the migration that globalised user preferences drops the table the old
code queries at import time.
