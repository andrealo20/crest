// The Screen Time and Day timeline faces as source text: the rules that keep them steady in width, still while the bar rests and on
// the first group's tracks, which no node test can watch while they draw. The widths and the bars' heights are model.test.ts's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...path: string[]) => readFileSync(join(import.meta.dirname, "..", "..", ...path), "utf8");
const faces = read("features", "taskbar", "window", "DayFaces.tsx");
const part = read("notch", "row", "parts", "ScreenTimePart.tsx");
const strip = read("features", "screentime", "DayStrip.tsx");

test("the strip's rail is the first group's track: faint ink, on fill-3 under Material", () => {
  assert.match(strip, /fill="currentColor" fillOpacity=\{0\.14\} className="material:fill-fill-3 material:\[fill-opacity:1\]"/);
});

test("the timeline is 144 px wide in both versions, and the line at the time now moves by transform alone", () => {
  assert.match(strip, /export const TIMELINE_W = 144;/);
  assert.match(faces, /width: TIMELINE_W/);
  assert.match(strip, /style=\{\{ transform: `translateX\(\$\{now\}px\)` \}\}/);
});

test("Screen Time's text sits in a box as wide as its figures with every digit an 8, and the face's width comes from the model", () => {
  assert.match(part, /measureTabular\(eights\(text\)\)/);
  assert.match(part, /width: screenFaceWidth\(v, room\)/);
  assert.match(faces, /width: screenFaceWidth\(v, screenText\(s\.total\)\.room\)/);
});

test("the hourglass is Screen Time's purple, primary under Material, and the hour now is full ink, primary under Material", () => {
  assert.match(part, /className="shrink-0 text-\(--hue-purple\) material:text-primary"/);
  assert.match(part, /className=\{i === hour \? "material:fill-primary" : undefined\}/);
});

test("the timeline ticks once a minute only while the bar shows, and nothing on the faces animates or blurs", () => {
  assert.deepEqual([...faces.matchAll(/useMinuteTick\(([^)]*)\)/g)].map((m) => m[1]), ["on && !paused"]);
  for (const src of [faces, part, strip]) {
    assert.doesNotMatch(src, /from "motion\/react"|blur|setInterval|useSecondTick/);
  }
});

test("the events cross the feed without their titles", () => {
  const sources = read("features", "screentime", "sources.tsx");
  assert.match(sources, /dayEvents\(data, day, addDays\(day, 1\) \+ 12 \* 3_600_000\)/);
  assert.doesNotMatch(sources, /\.title\b|title:/);
});
