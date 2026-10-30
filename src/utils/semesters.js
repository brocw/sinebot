// The academic semester as a window over results.
//
// Every other view is either all-time (`/crowns`) or a repeating slice of the
// calendar (`/periods`). This is the third framing: a bounded stretch with a
// start, an end, and a champion at the end of it.
//
// Pure — dates in, semesters out. Nothing here reads the database.

const ZONE = "America/New_York";

/**
 * UCF's calendar. Each entry starts on `[month, day]` (month 0-based) and runs
 * until the next one begins; the last runs to 31 December.
 *
 *   Spring  1 Jan – 5 May
 *   Summer  6 May – 23 Aug
 *   Fall   24 Aug – 31 Dec
 *
 * The whole calendar is this constant, so moving a boundary — or, later,
 * letting each guild set its own — is an edit in one place.
 */
export const SEMESTERS = [
  { id: "spring", label: "Spring", start: [0, 1] },
  { id: "summer", label: "Summer", start: [4, 6] },
  { id: "fall", label: "Fall", start: [7, 24] },
];

// Results are bucketed by their date in Eastern time, not in whatever zone the
// deploy box happens to run in. `monthKey` reads local time and nothing sets TZ
// on the server, so on a UTC host a result posted at 8pm ET on 5 May would land
// in Summer — the wrong side of a boundary the calendar states to the day.
const DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar day a timestamp falls on in Eastern time, as "2026-09-05". */
export function etDayKey(ts) {
  return DATE_FMT.format(new Date(ts));
}

function etParts(ts) {
  const [year, month, day] = etDayKey(ts).split("-").map(Number);
  return { year, month: month - 1, day };
}

/** Compares two `{ month, day }` pairs within a year. */
function onOrAfter({ month, day }, [m, d]) {
  return month > m || (month === m && day >= d);
}

const DAY_MS = 86_400_000;

function dayBefore({ year, month, day }) {
  const d = new Date(Date.UTC(year, month, day) - DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

/**
 * The semester with this id in this year.
 *
 * @returns {{ id: string, label: string, year: number, key: string,
 *             start: object, end: object }}
 */
export function semesterFor(id, year) {
  const i = SEMESTERS.findIndex((s) => s.id === id);
  if (i === -1) throw new Error(`Unknown semester "${id}"`);

  const { label, start } = SEMESTERS[i];
  const next = SEMESTERS[i + 1];

  return {
    id,
    label,
    year,
    key: `${year}-${id}`,
    start: { year, month: start[0], day: start[1] },
    // The last semester of the year runs to the end of it.
    end: next
      ? dayBefore({ year, month: next.start[0], day: next.start[1] })
      : { year, month: 11, day: 31 },
  };
}

/** The semester a timestamp falls in. */
export function semesterOf(ts) {
  const { year, month, day } = etParts(ts);
  // Spring opens on 1 January, so something always matches.
  const match = [...SEMESTERS].reverse().find((s) => onOrAfter({ month, day }, s.start));
  return semesterFor(match.id, year);
}

/** Shorthand for the semester in progress. */
export function currentSemester(date = new Date()) {
  return semesterOf(date.getTime());
}

/** The one before it, crossing the year: Spring 2026 follows Fall 2025. */
export function previousSemester(semester) {
  const i = SEMESTERS.findIndex((s) => s.id === semester.id);
  return i === 0
    ? semesterFor(SEMESTERS.at(-1).id, semester.year - 1)
    : semesterFor(SEMESTERS[i - 1].id, semester.year);
}

/** Whether a timestamp falls inside a semester. */
export function inSemester(ts, semester) {
  return semesterOf(ts).key === semester.key;
}

/** "Fall 2026". */
export function formatSemester({ label, year }) {
  return `${label} ${year}`;
}

const RANGE_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

/** "24 Aug – 31 Dec". */
export function formatRange({ start, end }) {
  const at = ({ year, month, day }) => RANGE_FMT.format(new Date(Date.UTC(year, month, day)));
  return `${at(start)} – ${at(end)}`;
}
