import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');
const STORE_PATH = join(DATA_DIR, 'crowns.json');

/**
 * Stable storage key for a name-type user.
 * Exported so the link-user command can resolve the same key without
 * duplicating normalisation logic.
 *
 * @param {string} raw  e.g. "Keanu B\\. || Vice President"
 * @returns {string}    e.g. "name:keanu b."
 */
export function nameKey(raw) {
  const namePart = raw.split('||')[0].trim().replace(/\\/g, '');
  return `name:${namePart.toLowerCase()}`;
}

function loadStore() {
  if (!existsSync(STORE_PATH)) {
    return { users: {}, nameAliases: {}, processedMessageIds: [] };
  }
  const store = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
  store.nameAliases ??= {};
  return store;
}

function saveStore(store) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

/**
 * Resolves the storage key for a user, routing name-type users through
 * the alias table so they land on the correct Discord ID entry.
 */
function resolveKey(store, user) {
  if (user.type === 'id') return user.id;
  const nk = nameKey(user.raw);
  return store.nameAliases[nk] ?? nk;
}

function applyResult(store, { scores }, messageId, ts) {
  if (store.processedMessageIds.includes(messageId)) return false;

  for (const [i, { score, isCrown, users }] of scores.entries()) {
    for (const user of users) {
      const key = resolveKey(store, user);
      const isResolved = user.type === 'id' || store.nameAliases[nameKey(user.raw)];

      if (!store.users[key]) {
        store.users[key] = {
          type: isResolved ? 'id' : 'name',
          scores: [],
          ...(!isResolved && { displayName: user.raw }),
        };
      }

      store.users[key].scores ??= [];
      store.users[key].scores.push({ score, isCrown, place: i + 1, messageId, ts });

      // Keep most-recent display name only for still-unresolved name entries.
      if (!isResolved) {
        store.users[key].displayName = user.raw;
      }
    }
  }

  store.processedMessageIds.push(messageId);
  return true;
}

/**
 * Records a single live result. Loads and saves the store on each call.
 *
 * @param {{ scores: { isCrown: boolean, users: any[] }[] }} parsedResult
 * @param {string} messageId
 * @returns {boolean} true if newly recorded
 */
export function recordResult(parsedResult, messageId, ts) {
  const store = loadStore();
  const changed = applyResult(store, parsedResult, messageId, ts);
  if (changed) saveStore(store);
  return changed;
}

/**
 * Rebuilds the crown database from scratch using the provided results.
 * Aliases are preserved so name→ID routing survives the rebuild.
 * Loads and saves the store exactly once.
 *
 * @param {{ result: object, messageId: string }[]} pairs
 * @returns {number} number of results recorded
 */
export function rebuildFromResults(pairs) {
  const existing = loadStore();
  const store = {
    users: {},
    nameAliases: existing.nameAliases,
    processedMessageIds: [],
  };
  let count = 0;
  for (const { result, messageId, ts } of pairs) {
    if (applyResult(store, result, messageId, ts)) count++;
  }
  saveStore(store);
  return count;
}

/**
 * Creates a permanent alias from a name key to a Discord user ID, then
 * immediately merges any crowns already recorded under the name key into
 * the ID entry.
 *
 * @param {string} raw           Raw display name as seen in Wordle results
 * @param {string} discordUserId
 * @returns {{ nk: string, mergedCrowns: number }}
 */
export function linkAlias(raw, discordUserId) {
  const store = loadStore();
  const nk = nameKey(raw);

  store.nameAliases[nk] = discordUserId;

  // Merge existing name-keyed scores into the ID entry.
  let mergedCrowns = 0;
  if (store.users[nk]) {
    const nameScores = store.users[nk].scores ?? [];
    mergedCrowns = nameScores.filter(s => s.isCrown).length;
    if (!store.users[discordUserId]) {
      store.users[discordUserId] = { type: 'id', scores: [] };
    }
    store.users[discordUserId].scores = [
      ...(store.users[discordUserId].scores ?? []),
      ...nameScores,
    ];
    delete store.users[nk];
  }

  saveStore(store);
  return { nk, mergedCrowns };
}

/**
 * Returns the full users map keyed by user ID or name key.
 * @returns {Record<string, { type: string, scores: { score: number|null, isCrown: boolean, messageId: string, ts: number }[], displayName?: string }>}
 */
export function getCrowns() {
  return loadStore().users;
}
