import { test } from "node:test";
import assert from "node:assert/strict";
import { plusSliders, plusTarget } from "./glassPlus.ts";

const near = (a: number, b: number, e = 1e-3) => assert.ok(Math.abs(a - b) < e, `${a} is not about ${b}`);
const DEFAULTS = { glassRefraction: 80, glassFrost: 0, glassRim: 100 };

test("at the sliders' defaults Liquid Glass + is the widgets' glass: their lens, their 1 px blur at every scale, their rim", () => {
  assert.deepEqual(plusSliders(DEFAULTS, 2), { strength: 1, lod: [1.5, 1.5], spec: 0.62 });
  assert.deepEqual(plusSliders(DEFAULTS, 1).lod, [0.5, 0.5]);
  near(plusSliders(DEFAULTS, 1.5).lod[0], 1.085);
});

test("Refraction scales the lens, Frost adds blur to the widgets' own in the middle, Rim light scales the rim", () => {
  const s = plusSliders({ glassRefraction: 200, glassFrost: 100, glassRim: 0 }, 2);
  assert.equal(s.strength, 2.5);
  assert.equal(s.lod[0], 1.5);
  near(s.lod[1], 2.997); // Glass's middle at Frost 100 is 2.9: Frost adds to the widgets' blur, it does not replace it
  assert.equal(s.spec, 0);
  assert.equal(plusSliders({ ...DEFAULTS, glassRim: 200 }, 2).spec, 1.24);
});

test("over a white backdrop Liquid Glass + shows at most what Glass shows there at the same veil", () => {
  const white = (l: number) => 1.05 / (l + 0.05);
  near(plusTarget([0, 0, 0, 0.78], 0.78), 0.0395, 1e-4); // Dark at Transparency 0
  near(plusTarget([0, 0, 0, 0.59], 0.59), 0.1413, 1e-4); // Dark at Transparency 100
  assert.ok(white(plusTarget([0, 0, 0, 0.78], 0.78)) > 11.7);
  assert.ok(white(plusTarget([0, 0, 0, 0.59], 0.59)) > 5.4); // Crest's clearest point: text 4.5:1, labels 3:1
  assert.equal(plusTarget([0, 0, 0, 1], 1), 0);
  assert.equal(plusTarget([0, 0, 0, 0], 0), 1);
});
