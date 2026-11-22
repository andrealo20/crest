import { test } from "node:test";
import assert from "node:assert/strict";
import { buttonDecor, lineUnder, type Decor } from "./decorModel.ts";

const d = (id: number, overlay: string | null, progress: Decor["progress"] = null): Decor => ({ id, overlay, progress, tip: overlay ? `tip ${id}` : "" });

test("the window in front wins the overlay, else the first in order that has one", () => {
  const decor = { 1: d(1, "a"), 2: d(2, "b"), 3: d(3, null) };
  const wins = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(buttonDecor(wins, decor, 2).overlay, { img: "b", tip: "tip 2" });
  assert.deepEqual(buttonDecor(wins, decor, 3).overlay, { img: "a", tip: "tip 1" });
  assert.deepEqual(buttonDecor(wins, decor, null).overlay, { img: "a", tip: "tip 1" });
});

test("the progress comes from the first window that has one", () => {
  const p = { state: "paused", value: 0.3 } as const;
  const decor = { 1: d(1, "a"), 2: d(2, null, p) };
  assert.deepEqual(buttonDecor([{ id: 1 }, { id: 2 }], decor, 1).progress, p);
});

test("a button with no windows, or none reported, shows nothing", () => {
  assert.deepEqual(buttonDecor([], { 1: d(1, "a") }, 1), { overlay: null, progress: null });
  assert.deepEqual(buttonDecor([{ id: 5 }], { 1: d(1, "a") }, 5), { overlay: null, progress: null });
});

test("the progress line replaces the mark, but attention keeps its mark", () => {
  const p = { state: "normal", value: 0.5 } as const;
  assert.equal(lineUnder("open", p), "progress");
  assert.equal(lineUnder("front", p), "progress");
  assert.equal(lineUnder("attention", p), "mark");
  assert.equal(lineUnder("open", null), "mark");
});
