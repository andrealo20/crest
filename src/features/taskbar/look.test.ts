import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BarShape } from "./model.ts";
import { LOOK, barGap, barLook, barNeed, barRadius, barVeil, glassShapes, groupBoxes, hitBoxes, itemGap, labelRise, magnify, plusShapes, themeVeils, tilePlaces } from "./look.ts";
import { GLASS, liveZone } from "../../notch/glass/params.ts";

test("the surface's veil", () => {
  const v = (o: Partial<Parameters<typeof barVeil>[0]>) => barVeil({ transparency: 0, glass: false, reduced: false, safe: 0.75, clearest: 0.5, ...o });
  assert.equal(v({}), 1);
  assert.equal(v({ transparency: 100 }), 0);
  assert.equal(v({ transparency: 25 }), 0.75);
  assert.equal(v({ glass: true }), 0.75);
  assert.equal(v({ glass: true, transparency: 100 }), 0.5);
  assert.equal(v({ glass: true, transparency: 100, reduced: true }), 1);
  assert.equal(v({ transparency: 100, reduced: true }), 1);
});

test("a theme's veils from its tokens", () => {
  assert.deepEqual(themeVeils({ "--glass-tint": "rgb(0 0 0 / 0.78)", "--glass-tint-clear": "rgb(0 0 0 / 0.59)" }), { safe: 0.78, clearest: 0.59 });
  assert.deepEqual(themeVeils({}), { safe: 1, clearest: 1 });
});

test("gaps by shape, and corners by shape and look", () => {
  const shapes: BarShape[] = ["docked", "floating", "capsule", "tiles"];
  assert.deepEqual(shapes.map((s) => barGap(s)), [0, 4, 4, 4]);
  // Between the items in a zone: 6 px on every shape, the tiles' own gap on Tiles.
  assert.deepEqual(shapes.map((s) => itemGap(s)), [6, 6, 6, LOOK.tileGap]);
  assert.deepEqual(shapes.map((s) => barRadius(s, 44, "crest")), [0, 12, 22, 12]);
  // Material: M3's floating toolbar full round, its large shape (16) on tiles, at the default height and at HEIGHT's ends.
  assert.deepEqual(shapes.map((s) => barRadius(s, 44, "material")), [0, 22, 22, 16]);
  assert.deepEqual(shapes.map((s) => barRadius(s, 32, "material")), [0, 16, 16, 16]);
  assert.deepEqual(shapes.map((s) => barRadius(s, 64, "material")), [0, 32, 32, 16]);
  // Liquid Glass +: the widgets' pills and their tiles' 0.9 of half the height; they have no docked shape, so it stays square.
  assert.deepEqual(shapes.map((s) => barRadius(s, 44, "plus")), [0, 22, 22, 19.8]);
  assert.deepEqual(shapes.map((s) => barRadius(s, 32, "plus")), [0, 16, 16, 14.4]);
});

test("Liquid Glass + is the bar's look where it is chosen under Glass and the live copy can run", () => {
  assert.equal(barLook({ glass: true, glassLook: "plus" }, true), "plus");
  // ARM64, the Store build, Windows before 24H2, a Mac, or Rust not answered yet.
  assert.equal(barLook({ glass: true, glassLook: "plus" }, false), "crest");
  assert.equal(barLook({ glass: false, glassLook: "plus" }, true), "crest");
  assert.equal(barLook({ glass: true, glassLook: "crest" }, true), "crest");
  // Under Material, Liquid Glass + still wins where it runs; elsewhere the bar wears Material's look.
  assert.equal(barLook({ glass: true, glassLook: "plus" }, true, "material"), "plus");
  assert.equal(barLook({ glass: true, glassLook: "plus" }, false, "material"), "material");
  assert.equal(barLook({ glass: false, glassLook: "plus" }, true, "material"), "material");
  assert.equal(barLook({ glass: true, glassLook: "crest" }, true, "material"), "material");
  assert.equal(barLook({ glass: true, glassLook: "crest" }, true, "crest"), "crest");
  assert.equal(barLook({ glass: true, glassLook: "plus" }, false), "crest");
});

test("the bar's corners and ink come from the chosen look, never from whether the glass shows this instant", () => {
  const src = readFileSync(new URL("./window/BarGlass.tsx", import.meta.url), "utf8");
  assert.match(src, /const appDesign = design\.use\(\);/);
  assert.match(src, /const look = barLook\(taskbar, supported, appDesign\);/);
  assert.match(src, /const ink = look === "plus" \?/);
  assert.match(src, /const radius = barRadius\(shape, height, look\);/);
});

test("the pointer's zones reach the window's bottom", () => {
  assert.deepEqual(hitBoxes([{ x: 10, y: 600, w: 300, h: 44 }, { x: 0, y: 0, w: 0, h: 44 }], 652), [{ x: 10, y: 600, w: 300, h: 52 }]);
});

test("the shapes the glass draws", () => {
  const box = { x: 0, y: 8, w: 1440, h: 44 };
  assert.deepEqual(glassShapes("docked", [box]).rects, [{ x: -4000, y: 8, w: 9440, h: 4044 }]);
  assert.deepEqual(glassShapes("floating", [box]), { rects: [box], plain: [] });
  const tiles = Array.from({ length: 30 }, (_, i) => ({ x: i * 46, y: 8, w: 40, h: 44 }));
  const t = glassShapes("tiles", tiles);
  assert.equal(t.rects.length, LOOK.maxTiles);
  assert.deepEqual(t.plain, tiles.slice(LOOK.maxTiles));
});

test("a tile's place, glass or plain, holds however often its part draws again", () => {
  const take = tilePlaces();
  const first = take(LOOK.maxTiles - 2);
  assert.equal(first(0), true);
  // Stato draws its tile in its own render, and again alone on each battery change: its place stays the 23rd.
  const status = take(1);
  for (let i = 0; i < 30; i++) assert.equal(status(0), true);
  const rest = take(3);
  assert.deepEqual([rest(0), rest(1), rest(2)], [true, false, false]);
});

test("Liquid Glass +'s shapes: a docked bar as its real box with only its top bending, the others as Glass draws them", () => {
  const box = { x: 0, y: 8, w: 1440, h: 44 }, empty = { x: 0, y: 0, w: 0, h: 0 };
  assert.deepEqual(plusShapes("docked", [box, empty]), { rects: [box], top: true });
  assert.deepEqual(plusShapes("docked", []), { rects: [], top: true });
  assert.deepEqual(plusShapes("floating", [box]), { rects: [box], top: false });
  const tiles = Array.from({ length: 30 }, (_, i) => ({ x: i * 46, y: 8, w: 40, h: 44 }));
  assert.deepEqual(plusShapes("tiles", tiles), { rects: tiles.slice(0, LOOK.maxTiles), top: false });
});

test("an empty box (a hidden element's at 0, 0) counts nowhere", () => {
  const box = { x: 100, y: 600, w: 40, h: 44 }, empty = { x: 0, y: 0, w: 0, h: 0 };
  assert.deepEqual(glassShapes("docked", [box, empty]), glassShapes("docked", [box]));
  assert.deepEqual(glassShapes("tiles", [empty, box]), { rects: [box], plain: [] });
  assert.deepEqual(glassShapes("floating", [box, empty]), { rects: [box], plain: [] });
  assert.deepEqual(barNeed([box, empty], 2), barNeed([box], 2));
  assert.equal(barNeed([empty], 2), null);
});

test("the zone the bar's copy needs", () => {
  assert.equal(barNeed([], 2), null);
  const m = GLASS.zoneMargin;
  assert.deepEqual(barNeed([{ x: 100, y: 600, w: 40, h: 44 }, { x: 900, y: 600, w: 40, h: 44 }], 2), { x: (100 - m) * 2, y: (600 - m) * 2, w: (840 + 2 * m) * 2, h: (44 + 2 * m) * 2 });
  // A capsule a few px wider stays inside the running zone: no new session.
  const win = { w: 2880, h: 1300 };
  const run = liveZone(barNeed([{ x: 600, y: 600, w: 240, h: 44 }], 2)!, null, 48, win);
  assert.deepEqual(liveZone(barNeed([{ x: 596, y: 600, w: 248, h: 44 }], 2)!, run, 48, win), run);
});

test("one box per group of tiles, empty groups dropped", () => {
  const a = { x: 10, y: 600, w: 40, h: 44 }, b = { x: 56, y: 600, w: 40, h: 44 }, c = { x: 900, y: 600, w: 40, h: 44 }, empty = { x: 0, y: 0, w: 0, h: 0 };
  assert.deepEqual(groupBoxes([[a, b], [], [c, empty]]), [{ x: 10, y: 600, w: 86, h: 44 }, c]);
  assert.deepEqual(groupBoxes([[empty]]), []);
});

test("the icon under the pointer grows by half, its neighbours less, and from two and a half places on not at all", () => {
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.001, `${a} is not about ${b}`);
  assert.equal(magnify(0, 42), 1.5);
  near(magnify(42, 42), 1.327);
  near(magnify(-42, 42), 1.327);
  near(magnify(84, 42), 1.048);
  assert.equal(magnify(105, 42), 1);
  assert.equal(magnify(400, 42), 1);
  assert.equal(magnify(Infinity, 42), 1);
});

test("a name rises by as much as its icon grows past the bar's top", () => {
  assert.equal(labelRise(24, 44), 2);
  assert.equal(labelRise(20, 32), 4);
  assert.equal(labelRise(40, 64), 8);
  assert.equal(labelRise(16, 44), 0);
});
