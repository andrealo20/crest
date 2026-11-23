import { test } from "node:test";
import assert from "node:assert/strict";
import { PANEL_MAX, clampSize, currentQuick, dragSize, fitScale, fromShown, limits, normalizeSizes, normalizeTextSizes, quickSize, sizeFor, stepScale, stepSize, stepTextSize, toPageCss, toSaved } from "./panelSize.ts";

const def = { w: 520, h: 250 };

test("limits: 80 % of the default, a floor, the window and the monitor", () => {
  assert.deepEqual(limits(def), { minW: 416, maxW: 740, minH: 200, maxH: 540 });
  assert.deepEqual(limits({ w: 300, h: 100 }), { minW: 360, maxW: 740, minH: 150, maxH: 540 });
  // A short monitor (1080 px at 150 % Windows scale and 150 % panel scale is 480 CSS px).
  assert.equal(limits(def, 480).maxH, 460);
  // Never below the minimum, even on a tiny monitor.
  assert.equal(limits(def, 100).maxH, 200);
  assert.equal(limits(def, Number.NaN).maxH, PANEL_MAX.h);
});

test("clamping and the saved size", () => {
  const l = limits(def);
  assert.deepEqual(clampSize({ w: 9999, h: 1 }, l), { w: 740, h: 200 });
  assert.deepEqual(clampSize({ w: Number.NaN, h: 300.6 }, l), { w: 416, h: 301 });
  assert.deepEqual(sizeFor(def, undefined), def);
  assert.deepEqual(sizeFor(def, { w: 600, h: 300 }), { w: 600, h: 300 });
  assert.deepEqual(sizeFor(def, { w: 600, h: 600 }, 400), { w: 600, h: 380 });
});

test("quick sizes and which one is set", () => {
  assert.deepEqual(quickSize(def, "compact"), { w: 442, h: 213 });
  assert.deepEqual(quickSize(def, "standard"), def);
  assert.deepEqual(quickSize(def, "spacious"), { w: 624, h: 300 });
  const defs = { a: def, b: { w: 600, h: 320 } };
  assert.equal(currentQuick(defs, {}), "standard");
  assert.equal(currentQuick(defs, { a: quickSize(def, "spacious"), b: quickSize(defs.b, "spacious") }), "spacious");
  assert.equal(currentQuick(defs, { a: { w: 500, h: 250 } }), null);
  // b saved the compact size of an older default: the choice stays on compact.
  assert.equal(currentQuick(defs, { a: quickSize(def, "compact"), b: { w: 400, h: 200 } }), "compact");
  assert.equal(currentQuick(defs, { a: quickSize(def, "compact") }), null);
});

test("dragging an edge keeps the panel centred", () => {
  const l = limits(def);
  assert.deepEqual(dragSize(def, "right", 10, 50, l), { w: 540, h: 250 });
  assert.deepEqual(dragSize(def, "left", 10, 0, l), { w: 500, h: 250 });
  assert.deepEqual(dragSize(def, "bottom", 30, 40, l), { w: 520, h: 290 });
  assert.deepEqual(dragSize(def, "bottom-left", -20, 10, l), { w: 560, h: 260 });
  assert.deepEqual(dragSize(def, "bottom-right", 500, -500, l), { w: 740, h: 200 });
});

test("the resize shortcut steps", () => {
  const l = limits(def);
  assert.deepEqual(stepSize(def, "right", l), { w: 540, h: 250 });
  assert.deepEqual(stepSize(def, "up", l), { w: 520, h: 230 });
  assert.deepEqual(stepSize({ w: 740, h: 540 }, "down", l), { w: 740, h: 540 });
});

test("a resize of a panel the tool bar holds wider than its tool: growing past it takes the new width, anything else never widens the tool (#82)", () => {
  const own = { w: 520, h: 250 };
  // From the 649 px on screen: past them the width is the tool's new one.
  assert.deepEqual(fromShown({ w: 689, h: 250 }, own, 649), { w: 689, h: 250 });
  // Narrower or only taller, the tool's own width stays, or the narrower one.
  assert.deepEqual(fromShown({ w: 629, h: 250 }, own, 649), { w: 520, h: 250 });
  assert.deepEqual(fromShown({ w: 649, h: 290 }, own, 649), { w: 520, h: 290 });
  assert.deepEqual(fromShown({ w: 480, h: 250 }, own, 649), { w: 480, h: 250 });
  // Not held, as wide as its tool: the resize as it is.
  assert.deepEqual(fromShown({ w: 600, h: 250 }, { w: 700, h: 250 }, 700), { w: 600, h: 250 });
});

test("positions survive scale round trips exactly and keep their device pixels", () => {
  const values = [0, 1, 2, 5, 7, 100, 101, 333, 1234, -1, -5, -7, -100, -999, 0.5, -2.25];
  for (const chain of [[100, 150, 100], [100, 125, 175, 100]]) {
    for (const v of values) {
      // Saved once at the first scale; a scale change only changes how the saved value is read.
      const saved = toSaved(v, chain[0]);
      for (const scale of chain) assert.ok(Math.abs((toPageCss(saved, scale) * scale) / 100 - saved) < 1e-9, `${v} at ${scale}`);
      assert.equal(toPageCss(saved, chain[chain.length - 1]), v, `${v} through ${chain.join(" > ")}`);
    }
  }
  // Dragged at 150 %, read again at 150 %: the same CSS px.
  assert.equal(toPageCss(toSaved(-40, 150), 150), -40);
  assert.equal(toPageCss(Number.NaN, 150), 0);
});

test("scale and saved sizes are repaired", () => {
  assert.equal(fitScale(150), 150);
  assert.equal(fitScale(125), 125);
  assert.equal(fitScale(80), 80);
  assert.equal(fitScale(130), 100);
  assert.equal(stepScale(100, 1), 110);
  assert.equal(stepScale(150, -1), 125);
  assert.equal(stepScale(200, 1), 200);
  assert.equal(stepScale(80, -1), 80);
  assert.equal(stepScale(133, 1), 110);
  assert.equal(fitScale("150"), 100);
  assert.deepEqual(normalizeSizes({ a: { w: 500.4, h: 200 }, b: { w: -1, h: 2 }, c: null, d: { w: "x", h: 1 } }), { a: { w: 500, h: 200 } });
  assert.deepEqual(normalizeSizes(null), {});
});

test("a tool whose layout needs its whole height cannot be made shorter (#64, the Music tool's controls)", () => {
  const music = { w: 520, h: 232, minH: 232 };
  assert.equal(limits(music).minH, 232);
  // A height saved before, below it, comes back up; the width keeps its 80 %.
  assert.deepEqual(sizeFor(music, { w: 416, h: 186 }), { w: 416, h: 232 });
  assert.equal(quickSize(music, "compact").h, 232);
  assert.equal(limits({ w: 520, h: 232 }).minH, 186);
});

test("a tool's text size keeps only the scale steps other than 100 %", () => {
  assert.deepEqual(normalizeTextSizes({ notes: 125, calc: 200, todos: 100, odd: 133, text: "150", none: null }), { notes: 125, calc: 200 });
  assert.deepEqual(normalizeTextSizes(null), {});
  assert.deepEqual(normalizeTextSizes("notes"), {});
});

test("Ctrl + and Ctrl - walk a tool's text size through the scale steps; Ctrl 0 and 100 % leave no entry", () => {
  assert.deepEqual(stepTextSize({}, "notes", 1), { notes: 110 });
  assert.deepEqual(stepTextSize({ notes: 110, calc: 150 }, "notes", -1), { calc: 150 });
  assert.deepEqual(stepTextSize({ notes: 200 }, "notes", 1), { notes: 200 });
  assert.deepEqual(stepTextSize({ notes: 80 }, "notes", -1), { notes: 80 });
  assert.deepEqual(stepTextSize({ notes: 175, calc: 90 }, "notes", 0), { calc: 90 });
});
