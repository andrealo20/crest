import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const faces = readFileSync(join(import.meta.dirname, "window", "ProductivityFaces.tsx"), "utf8");

test("the stopwatch's time sits in a box as wide as its figures with every digit an 8, so it widens only at 10:00 and at each new hour digit", () => {
  assert.match(faces, /const digitsWidth = \(text: string\) => measureTabular\(text\.replace\(\/\\d\/g, "8"\)\);/);
  assert.match(faces, /measureTabular\(String\(laps\)\.replace\(\/\\d\/g, "8"\), CAPTION_FONT\)/);
  assert.doesNotMatch(faces, /useSecondTick\(true/);
  assert.match(faces, /useSecondTick\(id === "stopwatch" && s\.startedAt !== null && !paused, swPhase\(s\)\)/);
});

test("the next to-do's ring keeps its track as the timer's ring does: faint in Crest's look, on fill-3 under Material", () => {
  assert.match(faces, /stroke="currentColor" strokeOpacity=\{0\.25\} strokeWidth="2" className="material:stroke-fill-3 material:\[stroke-opacity:1\]"/);
  assert.match(faces, /stroke="var\(--color-green\)"/);
});

test("the note preview keeps one width whatever its line, as the song title keeps titleMax", () => {
  assert.match(faces, /const NOTE_WIDTH = NOTE_ICON \+ NOTE_GAP \+ ROW\.titleMax;/);
  assert.match(faces, /width: NOTE_WIDTH/);
});
