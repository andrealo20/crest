import { test } from "node:test";
import assert from "node:assert/strict";
import { OVERVIEW_PARTS, OVERVIEW_PARTS_DEFAULT, normalizeOverviewParts, overviewHeight, setOverviewPart, type OverviewParts } from "./parts.ts";

const only = (...on: (keyof OverviewParts)[]): OverviewParts => Object.fromEntries(OVERVIEW_PARTS.map((id) => [id, on.includes(id)])) as OverviewParts;

test("every part shows by default, at today's height", () => {
  assert.ok(OVERVIEW_PARTS.every((id) => OVERVIEW_PARTS_DEFAULT[id]));
  assert.deepEqual(normalizeOverviewParts(undefined, false), OVERVIEW_PARTS_DEFAULT);
  assert.equal(overviewHeight(OVERVIEW_PARTS_DEFAULT), 252);
});

test("saved parts keep their booleans, anything else shows", () => {
  const p = normalizeOverviewParts({ weather: false, brightness: false, focus: "no", extra: false }, false);
  assert.equal(p.weather, false);
  assert.equal(p.brightness, false);
  assert.equal(p.focus, true);
  assert.ok(!("extra" in p));
  // An array is an object too, and holds no parts.
  assert.deepEqual(normalizeOverviewParts([false, false], false), OVERVIEW_PARTS_DEFAULT);
  assert.deepEqual(normalizeOverviewParts("clock", false), OVERVIEW_PARTS_DEFAULT);
});

test("a file with nothing left that always shows keeps the clock", () => {
  const none = { clock: false, weather: false, activity: false, focus: false, awake: false, volume: false };
  assert.equal(normalizeOverviewParts(none, false).clock, true);
  assert.equal(normalizeOverviewParts(none, true).clock, true);
  // The tiles never show on a Mac, so they cannot keep Overview there.
  const tiles = { clock: false, weather: false, activity: false };
  assert.equal(normalizeOverviewParts(tiles, true).clock, true);
  assert.equal(normalizeOverviewParts(tiles, false).clock, false);
});

test("the last part that always shows stays on; brightness and quick controls can always go", () => {
  const p = only("clock", "brightness", "controls");
  assert.equal(setOverviewPart(p, "clock", false, false), p);
  assert.equal(setOverviewPart(p, "brightness", false, false).brightness, false);
  assert.equal(setOverviewPart(p, "controls", false, false).controls, false);
  const both = setOverviewPart(p, "weather", true, false);
  assert.equal(both.weather, true);
  assert.equal(setOverviewPart(both, "clock", false, false).clock, false);
  // Nothing to change: the same object, so nothing is written.
  assert.equal(setOverviewPart(p, "clock", true, false), p);
  // On a Mac the tiles do not show, so they cannot keep Overview there.
  const mac = only("clock", "focus", "awake", "volume");
  assert.equal(setOverviewPart(mac, "clock", false, true), mac);
  assert.equal(setOverviewPart(mac, "clock", false, false).clock, false);
});

test("a hidden row gives back its height and its gap", () => {
  const off = (...ids: (keyof OverviewParts)[]) => overviewHeight({ ...OVERVIEW_PARTS_DEFAULT, ...Object.fromEntries(ids.map((id) => [id, false])) });
  // The weather alone keeps the row, at its own 42 px instead of the clock's 54.
  assert.equal(off("clock"), 240);
  assert.equal(off("weather"), 252);
  assert.equal(off("clock", "weather"), 188);
  assert.equal(off("activity"), 198);
  assert.equal(off("focus", "awake"), 252);
  assert.equal(off("focus", "awake", "volume"), 202);
  // Brightness and quick controls grow the panel only while they show (OverviewView's requestSize).
  assert.equal(off("brightness", "controls"), 252);
  // Under the 150 px floor, which sizeFor raises it to.
  assert.equal(overviewHeight(only("clock")), 148);
  assert.equal(overviewHeight(only("weather")), 136);
});
