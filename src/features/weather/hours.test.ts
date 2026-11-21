import { test } from "node:test";
import assert from "node:assert/strict";
import { hourStart, nextHours } from "./hours.ts";

test("an hour in a place's clock time is placed with the place's UTC offset", () => {
  // 09:00 in New York (UTC-5) is 14:00 UTC.
  assert.equal(hourStart("2026-11-04T09:00", -5 * 3600), Date.UTC(2026, 10, 4, 14));
  assert.equal(hourStart("2026-11-04T15:00", 0), Date.UTC(2026, 10, 4, 15));
  // Vienna, UTC+1.
  assert.equal(hourStart("2026-11-04T15:00", 3600), Date.UTC(2026, 10, 4, 14));
  // Without an offset: the PC's zone.
  assert.equal(hourStart("2026-11-04T15:00"), new Date(2026, 10, 4, 15).getTime());
});

test("the next hours start after now, however old the saved forecast is", () => {
  const hourly = ["14:00", "15:00", "16:00", "17:00", "18:00"].map((h) => ({ time: `2026-11-21T${h}` }));
  // Offset 0: the times are UTC wall times, so 15:10 UTC is past 15:00.
  assert.deepEqual(nextHours(hourly, 0, Date.parse("2026-11-21T15:10Z")).map((h) => h.time.slice(11)), ["16:00", "17:00", "18:00"]);
  assert.deepEqual(nextHours(hourly, 3600, Date.parse("2026-11-21T13:30Z")).map((h) => h.time.slice(11)), ["15:00", "16:00", "17:00"]);
  assert.deepEqual(nextHours(undefined, 0, 0), []);
  assert.deepEqual(nextHours(hourly, 0, Date.parse("2026-11-22T00:00Z")), []);
});
