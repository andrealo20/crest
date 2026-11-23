import { test } from "node:test";
import assert from "node:assert/strict";
import { awakeLeft, awakeOn, awakeStart, formatLeft, formatLeftMinutes } from "./awake.ts";

test("timed keep awake ends on its own, until turned off does not", () => {
  const a = awakeStart(30, 1000);
  assert.deepEqual(a, { minutes: 30, endsAt: 1000 + 30 * 60_000 });
  assert.equal(awakeLeft(a, 1000), 30 * 60_000);
  assert.equal(awakeOn(a, 1000 + 30 * 60_000 - 1), true);
  assert.equal(awakeOn(a, 1000 + 30 * 60_000), false);
  assert.equal(awakeLeft(a, 1000 + 40 * 60_000), 0);

  const forever = awakeStart(null, 1000);
  assert.equal(awakeOn(forever, 1e15), true);
  assert.equal(awakeLeft(forever, 1000), null);

  assert.equal(awakeOn(null, 0), false);
  assert.equal(awakeLeft(null, 0), null);
});

test("time left reads as a clock", () => {
  assert.equal(formatLeft(2 * 3600_000), "2:00:00");
  assert.equal(formatLeft(3900_000), "1:05:00");
  assert.equal(formatLeft(30 * 60_000), "30:00");
  assert.equal(formatLeft(59_001), "1:00");
  assert.equal(formatLeft(1), "0:01");
});

test("the bar's widget reads hours and minutes, the minutes rounded up so it never shows 0:00 while on", () => {
  assert.equal(formatLeftMinutes(65 * 60_000), "1:05");
  assert.equal(formatLeftMinutes(59.5 * 60_000), "1:00");
  assert.equal(formatLeftMinutes(30_000), "0:01");
  assert.equal(formatLeftMinutes(1440 * 60_000), "24:00");
});
