import { test } from "node:test";
import assert from "node:assert/strict";
import { SEGMENTS, TIMER_LOOKS, litCells, lookText, normalizeLook, pixelMatrix, progressOf, terminalBar, zenParts } from "./looks.ts";

test("text per look", () => {
  assert.equal(lookText("clean", 1500), "25:00");
  assert.equal(lookText("clean", 1499.2), "25:00"); // rounds up
  assert.equal(lookText("clean", 1499), "24:59");
  assert.equal(lookText("clean", 180 * 60), "180:00");
  assert.equal(lookText("pixel", 65), "1:05");
  assert.equal(lookText("dots", 0), "0:00");
  assert.equal(lookText("retro", 299), "04:59");
  assert.equal(lookText("retro", 3900), "1:05:00");
  assert.equal(lookText("terminal", 1499), "00:24:59");
  assert.equal(lookText("terminal", 7322), "02:02:02");
  assert.equal(lookText("hud", 1499.84), "24:59.9");
  assert.equal(lookText("hud", 1500), "25:00.0");
  assert.equal(lookText("hud", 0.01), "00:00.1");
  assert.equal(lookText("hud", 0), "00:00.0");
  assert.equal(lookText("zen", 1499), "25 min");
  assert.equal(lookText("zen", 61), "2 min");
  assert.equal(lookText("zen", 59.5), "1 min"); // 60 whole seconds left
  assert.equal(lookText("zen", 59), "59 s");
  assert.equal(lookText("clean", -3), "0:00");
});

test("zen parts", () => {
  assert.deepEqual(zenParts(60), { value: 1, unit: "min" });
  assert.deepEqual(zenParts(0), { value: 0, unit: "s" });
});

test("normalize look", () => {
  for (const l of TIMER_LOOKS) assert.equal(normalizeLook(l), l);
  assert.equal(normalizeLook("neon"), "clean");
  assert.equal(normalizeLook(undefined), "clean");
});

test("progress and lit cells", () => {
  assert.equal(progressOf(1500, 1500), 0);
  assert.equal(progressOf(0, 1500), 1);
  assert.equal(progressOf(750, 1500), 0.5);
  assert.equal(progressOf(10, 0), 1);
  assert.equal(litCells(1500, 1500, 40), 40);
  assert.equal(litCells(750, 1500, 40), 20);
  assert.equal(litCells(1, 1500, 40), 1); // last cell stays lit until the end
  assert.equal(litCells(0, 1500, 40), 0);
  assert.equal(litCells(2000, 1500, 40), 40);
});

test("terminal bar", () => {
  assert.equal(terminalBar(1500, 1500, 10), "[----------]");
  assert.equal(terminalBar(750, 1500, 10), "[#####-----]");
  assert.equal(terminalBar(0, 1500, 4), "[####]");
});

test("pixel matrix", () => {
  const m = pixelMatrix("1:0");
  assert.equal(m.length, 5);
  // 3 + gap + 1 + gap + 3
  assert.equal(m[0].length, 9);
  assert.deepEqual(m[1].map(Number), [1, 1, 0, 0, 1, 0, 1, 0, 1]);
  assert.deepEqual(pixelMatrix("x")[0], []);
});

test("seven segments", () => {
  assert.equal(SEGMENTS["8"], "abcdefg");
  assert.equal(SEGMENTS["1"], "bc");
  for (let d = 0; d <= 9; d++) assert.ok(SEGMENTS[String(d)].length >= 2);
});
