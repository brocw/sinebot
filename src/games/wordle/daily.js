// Outbound lookups are best-effort decoration on the daily summary, so every
// failure path returns null and the summary simply omits the line. Each call is
// bounded by a timeout — without one, a hung connection stalls the summary (and
// with it the message handler) indefinitely.
const TIMEOUT_MS = 5000;

async function getJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetches the NYT Wordle solution for a given date.
 *
 * @param {Date} date
 * @returns {Promise<string|null>} uppercase word, e.g. "CRANE"
 */
export async function fetchDailyWord(date) {
  const dateStr = date.toISOString().slice(0, 10);
  const data = await getJson(`https://www.nytimes.com/svc/wordle/v2/${dateStr}.json`);
  return data?.solution?.toUpperCase() ?? null;
}

// Datamuse frequency tag is occurrences per million words in COCA.
const TIERS = [
  [20, "a super real word"],
  [5, "a real word"],
  [1, "a barely real word"],
  [0.1, "a not real word"],
  [0, "a super not real word"],
];

/**
 * Returns a human-readable commonality label for a word using Datamuse.
 *
 * @param {string} word
 * @returns {Promise<string|null>}
 */
export async function assessCommonality(word) {
  const data = await getJson(
    `https://api.datamuse.com/words?sp=${encodeURIComponent(word.toLowerCase())}&md=f&max=1`,
  );
  const entry = data?.[0];
  if (!entry || entry.word.toLowerCase() !== word.toLowerCase()) return null;

  const freqTag = entry.tags?.find((t) => t.startsWith("f:"));
  if (!freqTag) return null;

  const freq = parseFloat(freqTag.slice(2));
  return TIERS.find(([min]) => freq >= min)[1];
}
