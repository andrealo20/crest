import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { itemLayer, marks } from "./itemLook.ts";

test("the marks under an app: Crest's of today, and Material's pill in place of the long mark in front", () => {
  const none = { dot: false, bar: false, pill: false };
  assert.deepEqual(marks("open", "crest"), { dot: true, bar: false, pill: false });
  assert.deepEqual(marks("front", "crest"), { dot: false, bar: true, pill: false });
  assert.deepEqual(marks("attention", "crest"), { dot: false, bar: true, pill: false });
  assert.deepEqual(marks("none", "crest"), none);
  assert.deepEqual(marks("open", "material"), { dot: true, bar: false, pill: false });
  assert.deepEqual(marks("front", "material"), { dot: false, bar: false, pill: true });
  assert.deepEqual(marks("attention", "material"), { dot: false, bar: true, pill: false });
  assert.deepEqual(marks("none", "material"), none);
});

test("the pill and the state layer: as wide as the button, centred, as tall as an M3 indicator, or the whole tile", () => {
  assert.deepEqual(itemLayer({ size: 24, width: 40 }), { left: 0, right: 0, top: "50%", height: 32, marginTop: -16, borderRadius: 16 });
  assert.deepEqual(itemLayer({ size: 24, width: 30 }), { left: 0, right: 0, top: "50%", height: 30, marginTop: -15, borderRadius: 15 });
  assert.deepEqual(itemLayer({ size: 24, width: 120, layer: 30 }), { left: 0, right: 0, top: "50%", height: 30, marginTop: -15, borderRadius: 15 });
  assert.deepEqual(itemLayer({ size: 24, width: 40, tile: { radius: 16 } }), { inset: 0, borderRadius: 16 });
});

const window = (name: string) => readFileSync(join(import.meta.dirname, "window", name), "utf8");

test("Item draws the pill and the state layer only under Material, the layer lit by the bar's hovered state and never by :hover", () => {
  const item = window("Item.tsx");
  assert.match(item, /\{material &&[^}]*data-front-pill/);
  const layer = /\{material && <span[^\n]*m3-layer[^\n]*/.exec(item);
  assert.ok(layer, "no state layer drawn under a material && branch");
  assert.match(layer[0], /data-hover=\{props\.lifted \|\| undefined\}/);
  // The window lets the pointer through off its zones and the page never sees pointerleave there, so a :hover would stay lit.
  assert.doesNotMatch(layer[0], /hover:/);
  assert.equal(item.match(/data-front-pill/g)?.length, 1);
  assert.equal(item.match(/m3-layer/g)?.length, 1);
  assert.match(window("Status.tsx"), /layer=\{pill\?\.height\}/);
});
