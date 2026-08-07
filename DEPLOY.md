# Deploying SINEBOT

Deploys are automatic: pushing to `main` runs the test suite, then deploys to the
DigitalOcean droplet over SSH via `.github/workflows/deploy.yml`. That workflow
snapshots the database, pulls, installs, and restarts pm2.

Two things are **not** automated and must be done by hand:

- **Registering slash commands** (`npm run deploy-commands`) — run from a
  workstation, whenever a command's name, description or options change.
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

### Database backups

Each deploy writes a snapshot to `data/backups/` before pulling and keeps the
fourteen most recent. This requires `sqlite3` on the droplet's `PATH`; the step
runs under `set -e`, so a missing binary aborts the deploy.

Migrations run on startup and are one-way. The snapshot is the rollback point.

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

`/config`, `/backfill` and `/link-user` require **Manage Server**, or the user ID
in `OWNER_ID`.

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
node --input-type=module -e "
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
const rest = new REST().setToken(process.env.DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: [] });
console.log('Cleared guild commands for', process.env.GUILD_ID);
"
```

Run this *after* `deploy-commands`, so you are never left with no commands.

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
