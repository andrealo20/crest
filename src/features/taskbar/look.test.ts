import { test } from "node:test";
import assert from "node:assert/strict";
import type { BarShape } from "./model.ts";
import { LOOK, barGap, barNeed, barRadius, barVeil, glassShapes, hitBoxes } from "./look.ts";
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

test("gaps and corners by shape", () => {
  assert.deepEqual(["docked", "floating", "capsule", "tiles"].map((s) => barGap(s as BarShape)), [0, 4, 4, 4]);
  assert.deepEqual(["docked", "floating", "capsule", "tiles"].map((s) => barRadius(s as BarShape, 44)), [0, 12, 22, 12]);
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

test("the zone the bar's copy needs", () => {
  assert.equal(barNeed([], 2), null);
  const m = GLASS.zoneMargin;
  assert.deepEqual(barNeed([{ x: 100, y: 600, w: 40, h: 44 }, { x: 900, y: 600, w: 40, h: 44 }], 2), { x: (100 - m) * 2, y: (600 - m) * 2, w: (840 + 2 * m) * 2, h: (44 + 2 * m) * 2 });
  // A capsule a few px wider stays inside the running zone: no new session.
  const win = { w: 2880, h: 1300 };
  const run = liveZone(barNeed([{ x: 600, y: 600, w: 240, h: 44 }], 2)!, null, 48, win);
  assert.deepEqual(liveZone(barNeed([{ x: 596, y: 600, w: 248, h: 44 }], 2)!, run, 48, win), run);
});
