import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_LAPS, STOPWATCH_IDLE, elapsedOf, elapsedText, idle, lapAt, lapText, splits, swPhase, toggleAt } from "./stopwatch.ts";

test("the stopwatch counts only while it runs, never backwards", () => {
  assert.equal(elapsedOf(STOPWATCH_IDLE, 5000), 0);
  assert.equal(elapsedOf({ startedAt: 1000, base: 500, laps: [] }, 3000), 2500);
  assert.equal(elapsedOf({ startedAt: 5000, base: 200, laps: [] }, 4000), 200);
  assert.equal(elapsedOf({ startedAt: null, base: 700, laps: [] }, 9000), 700);
});

test("start, pause and start again keep the time counted", () => {
  const a = toggleAt(STOPWATCH_IDLE, 1000);
  assert.deepEqual(a, { startedAt: 1000, base: 0, laps: [] });
  const b = toggleAt(a, 4500);
  assert.deepEqual(b, { startedAt: null, base: 3500, laps: [] });
  const c = toggleAt(b, 10000);
  assert.deepEqual(c, { startedAt: 10000, base: 3500, laps: [] });
  assert.equal(elapsedOf(c, 11000), 4500);
});

test("a lap is taken only while it runs, up to 99", () => {
  assert.equal(MAX_LAPS, 99);
  const r = { startedAt: 0, base: 0, laps: [] };
  assert.deepEqual(lapAt(r, 1200).laps, [1200]);
  assert.deepEqual(lapAt(lapAt(r, 1200), 2500).laps, [1200, 2500]);
  const paused = { startedAt: null, base: 800, laps: [] };
  assert.equal(lapAt(paused, 900), paused);
  const full = { ...r, laps: Array.from({ length: 99 }, (_, i) => i * 10) };
  assert.equal(lapAt(full, 5000), full);
});

test("idle is only the stopwatch never started or reset", () => {
  assert.equal(idle(STOPWATCH_IDLE), true);
  assert.equal(idle({ startedAt: 0, base: 0, laps: [] }), false);
  assert.equal(idle({ startedAt: null, base: 1, laps: [] }), false);
  assert.equal(idle({ startedAt: null, base: 0, laps: [0] }), false);
});

test("each lap's own time", () => {
  assert.deepEqual(splits([1200, 2500, 4100]), [1200, 1300, 1600]);
  assert.deepEqual(splits([]), []);
});

test("the stopwatch reads whole seconds, its laps tenths", () => {
  assert.equal(elapsedText(0), "0:00");
  assert.equal(elapsedText(59999), "0:59");
  assert.equal(elapsedText(61400), "1:01");
  assert.equal(elapsedText(3725000), "1:02:05");
  assert.equal(lapText(0), "0:00.0");
  assert.equal(lapText(1300), "0:01.3");
  assert.equal(lapText(59960), "0:59.9");
  assert.equal(lapText(61250), "1:01.2");
  assert.equal(lapText(3725400), "1:02:05.4");
});

test("the second turns over when the counted time's does", () => {
  assert.equal(swPhase({ startedAt: 10250, base: 0, laps: [] }), 250);
  assert.equal(swPhase({ startedAt: 10250, base: 400, laps: [] }), 850);
  assert.equal(swPhase({ startedAt: 100, base: 2300, laps: [] }), 800);
  assert.equal(swPhase(STOPWATCH_IDLE), 0);
});
