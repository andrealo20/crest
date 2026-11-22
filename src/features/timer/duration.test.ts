import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_REMEMBERED, MAX_SECONDS, MIN_SECONDS, clampDuration, customsOf, durationText, parseDuration, remember, wheelStep } from "./duration.ts";

test("a typed duration reads as minutes, M:SS or H:MM:SS within 5 seconds and 24 hours", () => {
  assert.equal(MIN_SECONDS, 5);
  assert.equal(MAX_SECONDS, 86400);
  assert.equal(parseDuration("25"), 1500);
  assert.equal(parseDuration(" 7 "), 420);
  assert.equal(parseDuration("2:30"), 150);
  assert.equal(parseDuration("0:05"), 5);
  assert.equal(parseDuration("1:05:00"), 3900);
  assert.equal(parseDuration("3:00:00"), 10800);
  assert.equal(parseDuration("180"), 10800);
  assert.equal(parseDuration("24:00:00"), 86400);
  assert.equal(parseDuration("1440"), 86400);
  for (const bad of ["", "0", "0:04", "1441", "24:00:01", "1:60", "1:5", "1::00", "1:00:00:00", "-5", "2.5", "abc"]) assert.equal(parseDuration(bad), null, bad);
});

test("a duration is written back as minutes when whole, else as the countdown reads it", () => {
  assert.equal(durationText(1500), "25");
  assert.equal(durationText(150), "2:30");
  assert.equal(durationText(3900), "65");
  assert.equal(durationText(3930), "1:05:30");
  assert.equal(durationText(45), "0:45");
  for (const d of [5, 45, 150, 1500, 3930, 10800, 86400]) assert.equal(parseDuration(durationText(d)), d, String(d));
});

test("durations stay within the limits", () => {
  assert.equal(clampDuration(2), 5);
  assert.equal(clampDuration(100000), 86400);
  assert.equal(clampDuration(90.4), 90);
});

test("the wheel moves to the next whole minute and never below one", () => {
  assert.equal(wheelStep(150, 1), 180);
  assert.equal(wheelStep(150, -1), 120);
  assert.equal(wheelStep(180, 1), 240);
  assert.equal(wheelStep(180, -1), 120);
  assert.equal(wheelStep(600, 5), 900);
  assert.equal(wheelStep(600, -5), 300);
  assert.equal(wheelStep(60, -1), 60);
  assert.equal(wheelStep(30, -1), 30);
  assert.equal(wheelStep(30, 1), 60);
  assert.equal(wheelStep(300, -5), 60);
  assert.equal(wheelStep(90, -5), 60);
  assert.equal(wheelStep(30, -5), 30);
  assert.equal(wheelStep(86390, 1), 86400);
  assert.equal(wheelStep(86400, 1), 86400);
});

test("remembered durations: a number saved by an older version, a list kept to three and to the limits, never a preset", () => {
  const p = [900, 1500, 2700];
  assert.equal(MAX_REMEMBERED, 3);
  assert.deepEqual(customsOf(undefined, p), []);
  assert.deepEqual(customsOf("junk", p), []);
  assert.deepEqual(customsOf(1200, p), [1200]);
  assert.deepEqual(customsOf(1500, p), []);
  assert.deepEqual(customsOf([200, "x", 200, 1500, -3, 100000, 300, 400, 500], p), [200, 300, 400]);
});

test("a started duration goes first, a preset is not remembered", () => {
  const p = [900, 1500, 2700];
  assert.deepEqual(remember([200, 300, 400], 500, p), [500, 200, 300]);
  assert.deepEqual(remember([200, 300], 300, p), [300, 200]);
  assert.deepEqual(remember([200], 1500, p), [200]);
  assert.deepEqual(remember([], 2220, p), [2220]);
});
