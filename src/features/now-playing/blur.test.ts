import { test } from "node:test";
import assert from "node:assert/strict";
import { boxBlur } from "./blur.ts";

test("a blur keeps a flat colour flat and spreads one bright pixel over its neighbours", () => {
  const w = 9, h = 9, px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i += 4) px.set([40, 80, 120, 255], i);
  boxBlur(px, w, h, 2);
  assert.deepEqual([...px.slice(0, 4)], [40, 80, 120, 255]);
  assert.deepEqual([...px.slice((4 * w + 4) * 4, (4 * w + 4) * 4 + 4)], [40, 80, 120, 255]);

  const dot = new Uint8ClampedArray(w * h * 4);
  dot.set([255, 255, 255, 255], (4 * w + 4) * 4);
  boxBlur(dot, w, h, 1, 1);
  const centre = dot[(4 * w + 4) * 4], side = dot[(4 * w + 5) * 4], far = dot[0];
  assert.ok(centre < 255 && centre > 0, `centre ${centre}`);
  assert.ok(side > 0, `side ${side}`);
  assert.equal(far, 0);
});
