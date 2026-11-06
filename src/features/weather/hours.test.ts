import { test } from "node:test";
import assert from "node:assert/strict";
import { hourStart } from "./hours.ts";

test("an hour in a place's clock time is placed with the place's UTC offset", () => {
  // 09:00 in New York (UTC-5) is 14:00 UTC.
  assert.equal(hourStart("2026-11-04T09:00", -5 * 3600), Date.UTC(2026, 10, 4, 14));
  assert.equal(hourStart("2026-11-04T15:00", 0), Date.UTC(2026, 10, 4, 15));
  // Vienna, UTC+1.
  assert.equal(hourStart("2026-11-04T15:00", 3600), Date.UTC(2026, 10, 4, 14));
  // Without an offset: the PC's zone.
  assert.equal(hourStart("2026-11-04T15:00"), new Date(2026, 10, 4, 15).getTime());
});
