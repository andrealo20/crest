import { test } from "node:test";
import assert from "node:assert/strict";
import { canvasBox, glassAllowed, lodFor, metaOk, parseTint, shapeUniform, snapshotLead, takes, textureMap, type GlassInput, type SnapshotMeta } from "./params.ts";

const near = (a: readonly number[], b: readonly number[]) => assert.ok(a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9), `${a} vs ${b}`);

const BASE: GlassInput = {
  on: true, windows: true, hangsFromTop: true, webgl: true,
  forcedColors: false, contrastMore: false, reducedTransparency: false, saver: false,
  fullscreen: false, hidden: false, presenting: false, cover: false, dragging: false, editing: false,
};

test("glass: on with everything it needs, off with any one thing missing or in the way", () => {
  assert.equal(glassAllowed(BASE), true);
  // Each field flipped on its own: the four it needs turn false, the others turn true.
  for (const key of Object.keys(BASE) as (keyof GlassInput)[]) assert.equal(glassAllowed({ ...BASE, [key]: !BASE[key] }), false, key);
});

test("the copy is asked for ahead of the hover delay, once the pointer rests", () => {
  assert.equal(snapshotLead("hover", 90), 50);
  assert.equal(snapshotLead("hover", 220), 100);
  assert.equal(snapshotLead("hover", 480), 360);
  assert.equal(snapshotLead("click", 90), 100);
  assert.equal(snapshotLead("click", 480), 100);
});

test("canvas box: both shapes with ears and overshoot, in even device pixels, within the window", () => {
  const peek = { w: 220, h: 34, ear: 7 }, panel = { w: 600, h: 400, ear: 14 }, win = { w: 760, h: 560 };
  const box = canvasBox(peek, panel, win, 2);
  assert.ok(box.w >= 600 * 1.06 + 28 + 2, String(box.w));
  assert.ok(box.h >= 400 * 1.06 + 2, String(box.h));
  assert.ok(box.px.every((p) => p % 2 === 0));
  assert.deepEqual(box.px, [box.w * 2, box.h * 2]);
  assert.deepEqual(canvasBox(panel, peek, win, 2), box);
  assert.equal(canvasBox(peek, { w: 740, h: 540, ear: 14 }, win, 2).w, 760);
  assert.equal(canvasBox(peek, { w: 740, h: 540, ear: 14 }, win, 2).h, 560);
  // At 125 % a whole even number of device pixels is a fraction of a CSS px.
  const odd = canvasBox(peek, panel, win, 1.25);
  assert.ok(odd.px.every((p) => p % 2 === 0) && Math.abs(odd.w * 1.25 - odd.px[0]) < 1e-9);
});

test("texture map: a point of the canvas to the copy's uv", () => {
  const meta: SnapshotMeta = { kind: "glass-backdrop", seq: 1, x: 0, y: 0, w: 1520, h: 1120, ww: 1520, wh: 1120 };
  const at = (m: ReturnType<typeof textureMap>, x: number, y: number) => [x * m.scale[0] + m.offset[0], y * m.scale[1] + m.offset[1]];
  const map = textureMap({ left: 10, top: 0 }, 1, 2, meta);
  near(at(map, 0, 0), [20 / 1520, 0]);
  near(at(map, 370, 270), [((10 + 370) * 2) / 1520, 540 / 1120]);
  // The window runs off the monitor on the left: the copy starts 40 px into it.
  near([textureMap({ left: 10, top: 0 }, 1, 2, { ...meta, x: 40 }).offset[0]], [map.offset[0] - 40 / 1520]);
  // The browser's CSS zoom (viewZoom): a CSS px of the shape covers 25 % more of the copy.
  near(textureMap({ left: 10, top: 0 }, 1.25, 2, meta).scale, [map.scale[0] * 1.25, map.scale[1] * 1.25]);
});

test("blur levels follow the scale, so the blur is the same in CSS px", () => {
  near(lodFor(2), [0.5, 2.9]);
  near(lodFor(1), [0, 1.9]);
  near(lodFor(4), [1.5, 3.9]);
});

test("shape uniform: the body centred in the canvas", () => {
  assert.deepEqual(shapeUniform(800, 740, 540, 14), [30, 770, 540, 14]);
});

test("tokens as the shader takes them", () => {
  near(parseTint("rgba(0, 0, 0, 0.78)")!, [0, 0, 0, 0.78]);
  near(parseTint("rgb(250, 250, 252)")!, [250 / 255, 250 / 255, 252 / 255, 1]);
  near(parseTint("#e6e9ef")!, [0xe6 / 255, 0xe9 / 255, 0xef / 255, 1]);
  assert.equal(parseTint("Canvas"), null);
  assert.equal(parseTint(""), null);
  assert.equal(parseTint(undefined), null);
});

const META: SnapshotMeta = { kind: "glass-backdrop", seq: 7, x: 0, y: 0, w: 4, h: 2, ww: 4, wh: 2 };

test("meta: checked at the border with Rust", () => {
  assert.equal(metaOk(META, 32), true);
  assert.equal(metaOk({ ...META, x: 1, w: 3 }, 24), true);
  assert.equal(metaOk(null, 32), false);
  assert.equal(metaOk("glass-backdrop", 32), false);
  assert.equal(metaOk({ ...META, kind: "other" }, 32), false);
  assert.equal(metaOk({ ...META, w: 3.5 }, 32), false);
  assert.equal(metaOk({ ...META, seq: "7" }, 32), false);
  assert.equal(metaOk({ ...META, x: 1 }, 32), false); // the area runs past the window
  assert.equal(metaOk({ ...META, y: -1 }, 32), false);
  assert.equal(metaOk(META, 31), false); // the buffer is short
  assert.equal(metaOk({ ...META, w: 16385, ww: 16385 }, 16385 * 2 * 4), false);
});

test("a buffer is taken only for the request waited on, of the window as it is", () => {
  const waiting = { seq: 7, pending: true };
  assert.equal(takes(waiting, META, [4, 2], 32), true);
  assert.equal(takes(waiting, META, [6, 4], 32), true); // within rounding of the window's size
  assert.equal(takes({ seq: 8, pending: true }, META, [4, 2], 32), false); // an older request
  assert.equal(takes({ seq: 7, pending: false }, META, [4, 2], 32), false); // given up, or dropped
  assert.equal(takes(waiting, META, [7, 2], 32), false); // the window changed size meanwhile
  assert.equal(takes(waiting, META, [4, 5], 32), false);
  assert.equal(takes(waiting, META, [4, 2], 16), false); // a short buffer
  assert.equal(takes(waiting, { ...META, kind: "x" }, [4, 2], 32), false);
});
