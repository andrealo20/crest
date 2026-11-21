import { test } from "node:test";
import assert from "node:assert/strict";
import { barMargin, beyond, edgeStrip, growFrom, innerOff, nudge, popupAt, popupY, slideBy, toEdge } from "./position.ts";

test("a popup opens away from the bar, the bottom as before", () => {
  assert.deepEqual(popupAt("bottom", 60), { bottom: 60 });
  assert.deepEqual(popupAt("top", 60), { top: 60 });
  // The bottom's y is the old rule: innerHeight - bottom - height.
  assert.equal(popupY("bottom", 60, 200, 632), 372);
  assert.equal(popupY("top", 60, 200, 632), 60);
  assert.equal(growFrom("bottom"), "50% 100%");
  assert.equal(growFrom("top"), "50% 0%");
  assert.equal(nudge("bottom"), 2);
  assert.equal(nudge("top"), -2);
});

test("the bar slides off its own edge and the pointer brings it back from there", () => {
  assert.equal(slideBy("bottom", 52), 52);
  assert.equal(slideBy("top", 52), -52);
  assert.deepEqual(edgeStrip("bottom", 2, 1920, 632), { x: 0, y: 630, w: 1920, h: 2 });
  assert.deepEqual(edgeStrip("top", 2, 1920, 632), { x: 0, y: 0, w: 1920, h: 2 });
});

test("the gap between the bar and the screen's edge belongs to the bar", () => {
  const bar = { x: 10, y: 584, w: 300, h: 44 };
  assert.deepEqual(toEdge("bottom", bar, 632), { x: 10, y: 584, w: 300, h: 48 });
  assert.deepEqual(toEdge("top", { x: 10, y: 4, w: 300, h: 44 }, 632), { x: 10, y: 0, w: 300, h: 48 });
});

test("past the bar is the screen's side, the gap at the edge is not", () => {
  const low = { top: 584, bottom: 628 }, high = { top: 4, bottom: 48 };
  assert.equal(innerOff("bottom", low, 632), 48);
  assert.equal(innerOff("top", high, 632), 48);
  assert.ok(beyond("bottom", 500, low) && !beyond("bottom", 600, low) && !beyond("bottom", 630, low));
  assert.ok(beyond("top", 100, high) && !beyond("top", 20, high) && !beyond("top", 1, high));
});

test("the bar's margin keeps it off the sides and its own edge", () => {
  assert.equal(barMargin("bottom", 4, false), "0 4px 4px");
  assert.equal(barMargin("bottom", 4, true), "0 0px 4px");
  assert.equal(barMargin("top", 4, false), "4px 4px 0");
  assert.equal(barMargin("top", 4, true), "4px 0px 0");
});
