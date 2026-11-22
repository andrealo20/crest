// The time faces as source text: the rules that keep them still while the bar rests, steady in width and on Crest's motion, which no
// node test can watch while they draw.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const window = (name: string) => readFileSync(join(import.meta.dirname, "window", name), "utf8");
const faces = window("TimeFaces.tsx");

test("the time progress draws its bar on the hardware bars' track and keeps room for its widest percent", () => {
  assert.match(faces, /className="relative block h-1 overflow-hidden rounded-full material:bg-fill-3!" style=\{\{ background: "color-mix\(in srgb, currentColor 25%, transparent\)" \}\}/);
  assert.match(faces, /measureTabular\("888%", CAPTION_FONT\)/);
});

test("every time face stops ticking while the bar rests or a preview shows its fixed time", () => {
  // One minute tick, which every face reads through useNow.
  assert.deepEqual([...faces.matchAll(/useMinuteTick\(([^)]*)\)/g)].map((m) => m[1]), ["!paused && at === undefined"]);
  assert.ok((faces.match(/useNow\(paused, at\)/g) ?? []).length >= 6);
  assert.doesNotMatch(faces, /useSecondTick|setInterval|requestAnimationFrame/);
});

test("the flip cards turn by transform and opacity alone, on the snappy spring, and nothing blurs", () => {
  assert.match(faces, /initial=\{\{ rotateX: -90, opacity: 0 \}\}/);
  assert.match(faces, /animate=\{\{ rotateX: 0, opacity: 1 \}\}/);
  assert.match(faces, /exit=\{\{ rotateX: 90, opacity: 0 \}\}/);
  assert.match(faces, /transition=\{springs\.snappy\}/);
  assert.doesNotMatch(faces, /blur|filter/);
});

test("the cards and the calendar tiles sit on fill-2, under Material on fill-3; the segments come from the timer's own looks", () => {
  assert.ok((faces.match(/bg-fill-2 material:bg-fill-3/g) ?? []).length >= 3);
  assert.match(faces, /import \{ SegmentDigits, segmentsWidth \} from "\.\.\/\.\.\/timer\/Look";/);
});

test("the analog dial takes a zone and a size, its hands from the zone's wall time", () => {
  const clock = window("BarClock.tsx");
  assert.match(clock, /export function BarAnalog\(\{ h12, paused, at, zone, size = ANALOG \}/);
  assert.match(clock, /getUTCHours\(\)/);
  assert.match(clock, /export const LINE = /);
  assert.match(clock, /export const zoneDiff = /);
});
