import { gameDay, dailyCallouts } from "./daily.js";
import { currentSemester } from "../utils/semesters.js";

export { renderDailySummary } from "./render.js";

const DAY_MS = 86_400_000;

const HEADING_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/New_York",
  weekday: "long",
  day: "numeric",
  month: "long",
});

/**
 * Builds the daily summary for a guild, posted when the aggregate game's
 * upstream bot reports yesterday's results.
 *
 * @param {{
 *   guildId: string,
 *   date: Date,                 // when the summary is posted
 *   games: object[],            // the games to report, in post order
 *   parsed?: Map<string, object>, // upstream messages, by game id
 * }} opts
 * @returns {Promise<{ heading: string, days: object[], callouts: object } | null>}
 *   null when no game has anything to report
 */
export async function buildDailySummary({ guildId, date, games, parsed = new Map() }) {
  const days = [];
  for (const game of games) {
    const day = await gameDay(game, game.store.getSeries(guildId), date, parsed.get(game.id) ?? null);
    if (day) days.push(day);
  }
  if (days.length === 0) return null;

  return {
    heading: `📅 Daily results · ${HEADING_FMT.format(new Date(date.getTime() - DAY_MS))}`,
    days,
    // The semester board is the one /semester shows at the moment of posting.
    callouts: dailyCallouts(days, { semester: currentSemester(date) }),
  };
}
