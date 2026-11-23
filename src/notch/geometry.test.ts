import { test } from "node:test";
import assert from "node:assert/strict";
import { dockWidth, openWidth } from "./geometry.ts";

test("the tool bar at full size: 42 px per tool, 2 px between, the separator, the gear and the padding", () => {
  assert.equal(dockWidth(1), 121);
  // The 13 tools a fresh install shows on Windows.
  assert.equal(dockWidth(13), 649);
});

test("a tool narrower than the tool bar opens as wide as the bar, so its icons stay in place from tool to tool (#82)", () => {
  assert.equal(openWidth(520, 13, 1920), 649);
  assert.equal(openWidth(600, 13, 1920), openWidth(520, 13, 1920));
  // A wider tool keeps its own width.
  assert.equal(openWidth(720, 13, 1920), 720);
  assert.equal(openWidth(649, 13, 1920), 649);
});

test("where the monitor or the widest panel cannot hold the bar, the tool keeps its own width and the bar narrows as before", () => {
  // A 1280 px monitor at 200 % is 640 px wide.
  assert.equal(openWidth(520, 13, 640), 520);
  // 16 tools ask for 781 px, more than the widest panel (740).
  assert.equal(openWidth(520, 16, 1920), 520);
  // Just as wide as the room still fits.
  assert.equal(openWidth(520, 13, 649), 649);
  assert.equal(openWidth(520, 13, Number.NaN), 520);
});
