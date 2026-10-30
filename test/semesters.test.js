import test from "node:test";
import assert from "node:assert/strict";
import {
  semesterOf,
  semesterFor,
  currentSemester,
  previousSemester,
  inSemester,
  formatSemester,
  formatRange,
  etDayKey,
} from "../src/utils/semesters.js";

const at = (iso) => formatSemester(semesterOf(Date.parse(iso)));

test("each boundary day belongs to the semester that opens on it", () => {
  // UCF's calendar states these to the day, so both sides of each are checked.
  assert.equal(at("2026-01-01T12:00:00-05:00"), "Spring 2026");
  assert.equal(at("2026-05-05T12:00:00-04:00"), "Spring 2026");
  assert.equal(at("2026-05-06T12:00:00-04:00"), "Summer 2026");
  assert.equal(at("2026-08-23T12:00:00-04:00"), "Summer 2026");
  assert.equal(at("2026-08-24T12:00:00-04:00"), "Fall 2026");
  assert.equal(at("2026-12-31T12:00:00-05:00"), "Fall 2026");
  assert.equal(at("2027-01-01T12:00:00-05:00"), "Spring 2027");
});

test("the day is read in Eastern time, not the server's zone", () => {
  // 8pm ET on the last day of Spring is already 6 May in UTC. Bucketing on the
  // box's local time would put this result in Summer on a UTC host.
  assert.equal(at("2026-05-05T20:00:00-04:00"), "Spring 2026");
  assert.equal(etDayKey(Date.parse("2026-05-05T20:00:00-04:00")), "2026-05-05");

  // And the mirror: just past midnight ET is still 5 May in UTC.
  assert.equal(at("2026-05-06T00:30:00-04:00"), "Summer 2026");
  assert.equal(etDayKey(Date.parse("2026-05-06T00:30:00-04:00")), "2026-05-06");
});

test("semesters carry the range they cover", () => {
  assert.equal(formatRange(semesterFor("spring", 2026)), "1 Jan – 5 May");
  assert.equal(formatRange(semesterFor("summer", 2026)), "6 May – 23 Aug");
  assert.equal(formatRange(semesterFor("fall", 2026)), "24 Aug – 31 Dec");
});

test("the previous semester walks back across the year", () => {
  const fall = currentSemester(new Date("2026-09-05T12:00:00-04:00"));
  assert.equal(formatSemester(fall), "Fall 2026");

  const summer = previousSemester(fall);
  const spring = previousSemester(summer);
  const lastFall = previousSemester(spring);

  assert.equal(formatSemester(summer), "Summer 2026");
  assert.equal(formatSemester(spring), "Spring 2026");
  assert.equal(formatSemester(lastFall), "Fall 2025");
});

test("inSemester keys on the semester, not on a raw date range", () => {
  const spring = semesterFor("spring", 2026);
  assert.equal(inSemester(Date.parse("2026-03-01T12:00:00-05:00"), spring), true);
  assert.equal(inSemester(Date.parse("2026-06-01T12:00:00-04:00"), spring), false);
  // Same calendar day, different year.
  assert.equal(inSemester(Date.parse("2025-03-01T12:00:00-05:00"), spring), false);
});
