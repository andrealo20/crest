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
