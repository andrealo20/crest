import { test } from "node:test";
import assert from "node:assert/strict";
import { bridge, slides, touches, zones } from "./autoHide.ts";

test("a window touches the bar only where they overlap", () => {
  const band = { x: 4, y: 556, w: 1912, h: 76 };
  assert.equal(touches(null, band), false);
  assert.equal(touches({ x: 0, y: 0, w: 1920, h: 632 }, band), true); // maximized, down to the screen's edge
  assert.equal(touches({ x: 0, y: 0, w: 1920, h: 556 }, band), false); // its bottom on the bar's top edge
  assert.equal(touches({ x: 0, y: 0, w: 1920, h: 557 }, band), true); // one pixel in
  assert.equal(touches({ x: 1916, y: 300, w: 400, h: 400 }, band), false); // beside the bar
});

test("the bar slides away only while nothing holds it", () => {
  const p = { on: true, covered: true, pointer: false, open: false, attention: false, held: false };
  assert.equal(slides(p), true);
  for (const k of ["pointer", "open", "attention"] as const) assert.equal(slides({ ...p, [k]: true }), false);
  assert.equal(slides({ ...p, on: false }), false);
  assert.equal(slides({ ...p, covered: false }), false);
});

test("a Windows surface holds the bar up like a menu", () => {
  const base = { on: true, covered: true, pointer: false, open: false, attention: false };
  assert.equal(slides({ ...base, held: false }), true);
  assert.equal(slides({ ...base, held: true }), false);
});

test("a bar that slid away keeps only the strip at the bottom edge", () => {
  const band = { x: 4, y: 556, w: 1912, h: 76 }, menu = { x: 300, y: 380, w: 220, h: 170 }, strip = { x: 0, y: 630, w: 1920, h: 2 };
  assert.deepEqual(zones({ bands: [band], open: [], on: true, down: true, width: 1920, height: 632 }), [strip]);
  assert.deepEqual(zones({ bands: [band], open: [menu], on: true, down: false, width: 1920, height: 632 }), [band, menu, strip]);
  assert.deepEqual(zones({ bands: [band], open: [], on: false, down: false, width: 1920, height: 632 }), [band]); // the option off: as in phase 2
  // Tiles: a band per group of tiles, so a click between the groups reaches the window below; none of them while the bar is down.
  const left = { x: 4, y: 556, w: 120, h: 76 }, right = { x: 1700, y: 556, w: 216, h: 76 };
  assert.deepEqual(zones({ bands: [left, right], open: [menu], on: true, down: false, width: 1920, height: 632 }), [left, right, menu, strip]);
  assert.deepEqual(zones({ bands: [left, right], open: [], on: true, down: true, width: 1920, height: 632 }), [strip]);
});

test("a preview's zone reaches down to its button, so the pointer crossing the gap stays on the bar", () => {
  assert.deepEqual(bridge({ x: 100, y: 600, w: 400, h: 160 }, { x: 280, y: 820, w: 40, h: 44 }), { x: 100, y: 600, w: 400, h: 264 });
  assert.deepEqual(bridge({ x: 0, y: 600, w: 200, h: 100 }, { x: 180, y: 720, w: 40, h: 44 }), { x: 0, y: 600, w: 220, h: 164 });
});

test("a top bar that slid away keeps only the strip at the top edge", () => {
  const band = { x: 4, y: 0, w: 1912, h: 52 }, strip = { x: 0, y: 0, w: 1920, h: 2 };
  assert.deepEqual(zones({ bands: [band], open: [], on: true, down: true, edge: "top", width: 1920, height: 632 }), [strip]);
  assert.deepEqual(zones({ bands: [band], open: [], on: true, down: false, edge: "top", width: 1920, height: 632 }), [band, strip]);
});
