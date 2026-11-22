import { test } from "node:test";
import assert from "node:assert/strict";
import { percentOf, shareOf } from "./progress.ts";

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

test("the day's share counts the wall clock, so noon is half the day also when the clocks change", () => {
  assert.equal(shareOf(at(2026, 3, 29), "day"), 0);
  assert.equal(shareOf(at(2026, 3, 29, 6), "day"), 0.25);
  assert.equal(shareOf(at(2026, 3, 29, 18), "day"), 0.75);
  // The 29th of March 2026 has 23 hours in most of Europe: still 50% at noon.
  assert.equal(shareOf(at(2026, 3, 29, 12), "day"), 0.5);
});

test("the month's share counts its own days, February's 28 among them", () => {
  assert.equal(shareOf(at(2026, 2, 15), "month"), 0.5);
  assert.equal(shareOf(at(2026, 11, 16), "month"), 0.5);
  assert.equal(shareOf(at(2026, 11, 1), "month"), 0);
});

test("the year's share counts its own days, a leap year's 366 among them", () => {
  assert.equal(shareOf(at(2026, 7, 2, 12), "year"), 0.5);
  // 2024 has 366 days: its half ends at the start of the 2nd of July, half a day before 2026's.
  assert.equal(shareOf(at(2024, 7, 2), "year"), 0.5);
  assert.equal(shareOf(at(2026, 1, 1), "year"), 0);
});

test("the percent is rounded down, also where the float lands just under a whole number", () => {
  assert.equal(percentOf(0.999), 99);
  assert.equal(percentOf(0.6049), 60);
  assert.equal(percentOf(0), 0);
  // 0.29 * 100 is 28.999999999999996 in floating point: the day at 06:57:36 is 29%.
  assert.equal(percentOf(shareOf(at(2026, 3, 30, 6, 57) + 36_000, "day")), 29);
  assert.equal(percentOf(0.29), 29);
});
