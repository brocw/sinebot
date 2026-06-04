/**
 * Fetches the NYT Wordle solution for a given date.
 * Returns null on any failure so callers degrade gracefully.
 *
 * @param {Date} date
 * @returns {Promise<string|null>} uppercase word, e.g. "CRANE"
 */
export async function fetchDailyWord(date) {
  const dateStr = date.toISOString().slice(0, 10);
  try {
    const res = await fetch(`https://www.nytimes.com/svc/wordle/v2/${dateStr}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.solution?.toUpperCase() ?? null;
  } catch {
    return null;
  }
}

// Datamuse frequency tag is occurrences per million words in COCA.
const TIERS = [
  [20,  'an extremely common word'],
  [5,   'a very common word'],
  [1,   'a fairly common word'],
  [0.1, 'an uncommon word'],
  [0,   'a rare or obscure word'],
];

/**
 * Returns a human-readable commonality label for a word using Datamuse.
 * Returns null on any failure.
 *
 * @param {string} word
 * @returns {Promise<string|null>}
 */
export async function assessCommonality(word) {
  try {
    const res = await fetch(
      `https://api.datamuse.com/words?sp=${encodeURIComponent(word.toLowerCase())}&md=f&max=1`
    );
    if (!res.ok) return null;
    const [entry] = await res.json();
    if (!entry || entry.word.toLowerCase() !== word.toLowerCase()) return null;
    const freqTag = entry.tags?.find(t => t.startsWith('f:'));
    if (!freqTag) return null;
    const freq = parseFloat(freqTag.slice(2));
    return TIERS.find(([min]) => freq >= min)[1];
  } catch {
    return null;
  }
}
