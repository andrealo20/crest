import { test } from "node:test";
import assert from "node:assert/strict";
import { EPSILON, FRAME_MS, due, moved, napMs, rests } from "./pacing.ts";

/**
 * The frames that draw over two seconds on a display at `hz`, as gaps in frames between them. The timestamps are off by up to
 * 0.1 ms, as requestAnimationFrame's are on a real one.
 */
function gaps(hz: number, every: number): number[] {
  const period = 1000 / hz;
  const at = (k: number) => k * period + (((k * 7919) % 11) - 5) * 0.02;
  const drawn = [0];
  for (let k = 1; k * period < 2000; k++) if (due(at(k), at(drawn[drawn.length - 1]), every)) drawn.push(k);
  return drawn.slice(1).map((k, i) => k - drawn[i]);
}

test("the four small bars draw whole frames at about 30 fps on every common refresh rate", () => {
  for (const hz of [50, 59.94, 60, 75, 90, 100, 120, 144, 165, 240, 360]) {
    const g = gaps(hz, FRAME_MS.bars);
    assert.equal(new Set(g).size, 1, `${hz} Hz: uneven gaps ${[...new Set(g)]}`);
    const fps = hz / g[0];
    assert.ok(fps >= 25 && fps <= 31, `${hz} Hz: ${fps.toFixed(1)} fps`);
  }
});

test("the Music tool's Spectrum and Wave keep about 60 fps, evenly", () => {
  for (const look of ["spectrum", "wave"] as const)
    for (const hz of [60, 120, 144, 165, 240]) {
      const g = gaps(hz, FRAME_MS[look]);
      assert.equal(new Set(g).size, 1, `${look} at ${hz} Hz: uneven gaps ${[...new Set(g)]}`);
      const fps = hz / g[0];
      assert.ok(fps >= 55 && fps <= 75, `${look} at ${hz} Hz: ${fps.toFixed(1)} fps`);
    }
});

test("the four bars nap between drawn frames and wake before the next one that can draw, even on a 15.6 ms timer", () => {
  // Windows' default timer tick, the most a timer may wait on battery.
  const tick = 1000 / 64;
  assert.ok(napMs(FRAME_MS.bars) > 0);
  assert.ok(napMs(FRAME_MS.bars) + tick < FRAME_MS.bars);
  // Spectrum and Wave draw every frame or every other at 144 Hz: no room for a nap, they keep requestAnimationFrame.
  for (const look of ["spectrum", "wave"] as const) assert.ok(napMs(FRAME_MS[look]) <= 0, look);
});

test("a bar is written only once it moved by a visible amount", () => {
  assert.equal(moved(0.5, 0.5), false);
  assert.equal(moved(0.5 + EPSILON / 2, 0.5), false);
  assert.equal(moved(0.5 - EPSILON * 1.5, 0.5), true);
  // Nothing drawn yet (-1): the first frame writes every bar.
  assert.equal(moved(0.24, -1), true);
});

test("the loop sleeps once the bars stand where they are heading, never while they breathe", () => {
  const at = [0.24, 0.5, 0.7, 0.3];
  const near = at.map((v) => v + EPSILON / 2);
  // Paused and settled, or reduced motion.
  assert.equal(rests(near, at, false, false), true);
  // Playing on steady real levels: nothing moves until the next ones arrive, and those wake the loop.
  assert.equal(rests(near, at, true, true), true);
  // Playing on silence or without levels: the breathing and the synthetic motion move the bars by themselves.
  assert.equal(rests(near, at, true, false), false);
  // A bar still on its way.
  assert.equal(rests([0.24, 0.5, 0.75, 0.3], at, false, false), false);
  assert.equal(rests([0.24, 0.5, 0.75, 0.3], at, true, true), false);
});
