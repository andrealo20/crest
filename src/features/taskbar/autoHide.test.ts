import { test } from "node:test";
import assert from "node:assert/strict";
import { slides, touches, zones } from "./autoHide.ts";

test("a window touches the bar only where they overlap", () => {
  const band = { x: 4, y: 556, w: 1912, h: 76 };
  assert.equal(touches(null, band), false);
  assert.equal(touches({ x: 0, y: 0, w: 1920, h: 632 }, band), true); // maximized, down to the screen's edge
  assert.equal(touches({ x: 0, y: 0, w: 1920, h: 556 }, band), false); // its bottom on the bar's top edge
  assert.equal(touches({ x: 0, y: 0, w: 1920, h: 557 }, band), true); // one pixel in
  assert.equal(touches({ x: 1916, y: 300, w: 400, h: 400 }, band), false); // beside the bar
});

test("the bar slides away only while nothing holds it", () => {
  const p = { on: true, covered: true, pointer: false, open: false, attention: false };
  assert.equal(slides(p), true);
  for (const k of ["pointer", "open", "attention"] as const) assert.equal(slides({ ...p, [k]: true }), false);
  assert.equal(slides({ ...p, on: false }), false);
  assert.equal(slides({ ...p, covered: false }), false);
});

test("a bar that slid away keeps only the strip at the bottom edge", () => {
  const band = { x: 4, y: 556, w: 1912, h: 76 }, menu = { x: 300, y: 380, w: 220, h: 170 }, strip = { x: 0, y: 630, w: 1920, h: 2 };
  assert.deepEqual(zones({ band, open: [], on: true, down: true, width: 1920, height: 632 }), [strip]);
  assert.deepEqual(zones({ band, open: [menu], on: true, down: false, width: 1920, height: 632 }), [band, menu, strip]);
  assert.deepEqual(zones({ band, open: [], on: false, down: false, width: 1920, height: 632 }), [band]); // the option off: as in phase 2
});
