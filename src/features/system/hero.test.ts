import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MARKS, SHAPES, brandOf, idHash, loadShape, mixPoints, pathOf, shapePoints, type ShapeName } from "./hero.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("every load shape is 120 points in its 100 x 100 box, starting halfway between two lobes", () => {
  for (const name of Object.keys(SHAPES) as ShapeName[]) {
    const [lobes, a] = SHAPES[name];
    const p = shapePoints(lobes, a);
    assert.equal(p.length, 240, name);
    assert.ok(p.every((n) => n >= 0 && n <= 100), name);
    let far = 0;
    for (let i = 0; i < p.length; i += 2) far = Math.max(far, Math.hypot(p[i] - 50, p[i + 1] - 50));
    assert.ok(far >= 49 && far <= 50 + 1e-9, `${name}: ${far}`);
    assert.ok(Math.abs(p[0] - (50 + 50 / (1 + a))) < 1e-9, name);
    assert.ok(Math.abs(p[1] - 50) < 1e-9, name);
  }
});

test("two shapes mix point by point, and the ends are the shapes themselves", () => {
  const a = shapePoints(...SHAPES.cookie4);
  const b = shapePoints(...SHAPES.sunny);
  assert.deepEqual(mixPoints(a, b, 0), a);
  assert.deepEqual(mixPoints(a, b, 1), b);
  assert.ok(Math.abs(mixPoints(a, b, 0.5)[0] - (a[0] + b[0]) / 2) < 1e-9);
});

test("a shape's path", () => {
  const d = pathOf(shapePoints(4, 0.12));
  assert.ok(d.startsWith("M"));
  assert.ok(d.endsWith("Z"));
  assert.equal(d.match(/L/g)?.length, 119);
  assert.ok((d.match(/-?\d+(\.\d+)?/g) ?? []).every((n) => /\.\d{2}$/.test(n)), d.slice(0, 80));
});

test("the load shape goes up at 40 and 80 % and down only under 35 and 75 %", () => {
  const cases: [ShapeName, number | null, ShapeName][] = [
    ["cookie4", 39, "cookie4"],
    ["cookie4", 41, "sunny"],
    ["sunny", 37, "sunny"],
    ["sunny", 34, "cookie4"],
    ["sunny", 80, "softBurst"],
    ["softBurst", 76, "softBurst"],
    ["softBurst", 74, "sunny"],
    ["softBurst", 20, "cookie4"],
    ["cookie4", 85, "softBurst"],
    ["sunny", null, "cookie4"],
  ];
  for (const [prev, percent, want] of cases) assert.equal(loadShape(prev, percent), want, `${prev} at ${percent}`);
});

test("every settings page has a mark, and no two pages in a row share a lobe count", () => {
  const src = read("../settings/SettingsView.tsx");
  const start = src.indexOf("const allPages");
  const block = src.slice(start, src.indexOf("];", start));
  const ids = [...block.matchAll(/\{ id: "([\w-]+)", label:/g)].map((m) => m[1]);
  assert.ok(ids.length >= 14, `${ids.length} pages`);
  for (const id of [...ids, "search"]) assert.ok(id in MARKS, id);
  for (let i = 1; i < ids.length; i++) assert.notEqual(brandOf(ids[i])[0], brandOf(ids[i - 1])[0], `${ids[i - 1]} then ${ids[i]}`);
  const inRange = ([lobes, a]: readonly [number, number]) => Number.isInteger(lobes) && lobes >= 4 && lobes <= 12 && a >= 0.05 && a <= 0.15;
  for (const [id, mark] of Object.entries(MARKS)) assert.ok(inRange(mark), id);
  // A page added later (the bar's Widget page) falls back to the hash.
  assert.deepEqual(brandOf("widgets"), brandOf("widgets"));
  assert.ok(inRange(brandOf("widgets")), String(brandOf("widgets")));
});

test("the id hash is stable and an unsigned 32-bit integer", () => {
  const h = idHash("general");
  assert.equal(idHash("general"), h);
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff, String(h));
});

test("the morph writes its path from JavaScript on Material's spring, and jumps with reduced motion", () => {
  const src = read("./Morph.tsx");
  for (const s of ["springs.morph", 'setAttribute("d"', "mixPoints(", "pathOf(", "useReducedMotion"]) assert.ok(src.includes(s), s);
  // No CSS transition of any kind (a style, a prop or a Tailwind class): WebKit does not animate d.
  assert.doesNotMatch(src, /transition[:=-]|transitionProperty/);
  for (const s of ["blur(", "color-mix(", "linear(", ":dir("]) assert.ok(!src.includes(s), s);
  assert.doesNotMatch(src, /\b(bg|text|fill|stroke|ring|border)-[\w-]+\/\d/);
});
