import { test } from "node:test";
import assert from "node:assert/strict";
import { stepTool, toolArrow, type ArrowKey } from "./toolKeys.ts";

const k = (key: string, mods: Partial<ArrowKey> = {}): ArrowKey => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  defaultPrevented: false,
  repeat: false,
  ...mods,
});

test("a control that has used Alt+arrow keeps it: the slider moves, the tool stays", () => {
  assert.equal(toolArrow(k("ArrowRight", { altKey: true, defaultPrevented: true }), false, false, false), 0);
  assert.equal(toolArrow(k("ArrowRight", { altKey: true, metaKey: true, defaultPrevented: true }), false, true, false), 0);
});

test("a held arrow switches once, never through every tool at key-repeat speed (Camera, Find)", () => {
  assert.equal(toolArrow(k("ArrowRight", { repeat: true }), false, false, false), 0);
  assert.equal(toolArrow(k("ArrowLeft", { altKey: true, repeat: true }), true, false, false), 0);
});

test("Left and Right switch tools where nothing else takes them (#99)", () => {
  assert.equal(toolArrow(k("ArrowRight"), false, false, false), 1);
  assert.equal(toolArrow(k("ArrowLeft"), false, false, false), -1);
  // A text field keeps them for its cursor; a slider or a switch has already taken them.
  assert.equal(toolArrow(k("ArrowRight"), true, false, false), 0);
  assert.equal(toolArrow(k("ArrowRight", { defaultPrevented: true }), false, false, false), 0);
  // Up and Down, and other keys, are not for switching.
  assert.equal(toolArrow(k("ArrowUp"), false, false, false), 0);
  assert.equal(toolArrow(k("Tab"), false, false, false), 0);
});

test("Alt+Left and Alt+Right switch inside a text field too, and other modifiers never do", () => {
  assert.equal(toolArrow(k("ArrowRight", { altKey: true }), true, false, false), 1);
  assert.equal(toolArrow(k("ArrowLeft", { altKey: true }), true, false, false), -1);
  // Shift selects, Ctrl jumps by word: they stay with the field, alone or with Alt.
  for (const mods of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true, shiftKey: true }, { altKey: true, ctrlKey: true }]) {
    assert.equal(toolArrow(k("ArrowRight", mods), false, false, false), 0, JSON.stringify(mods));
  }
  assert.equal(toolArrow(k("ArrowRight", { altKey: true, metaKey: true }), true, false, false), 0);
});

test("on a Mac the pair is Cmd+Option, since Option alone moves the cursor by word", () => {
  assert.equal(toolArrow(k("ArrowRight", { altKey: true }), true, true, false), 0);
  assert.equal(toolArrow(k("ArrowRight", { altKey: true, metaKey: true }), true, true, false), 1);
  assert.equal(toolArrow(k("ArrowLeft", { altKey: true, metaKey: true }), true, true, false), -1);
  assert.equal(toolArrow(k("ArrowRight", { altKey: true, metaKey: true, shiftKey: true }), true, true, false), 0);
  assert.equal(toolArrow(k("ArrowRight"), false, true, false), 1);
});

test("right to left, Right goes to the tool shown on the right, the previous one", () => {
  assert.equal(toolArrow(k("ArrowRight"), false, false, true), -1);
  assert.equal(toolArrow(k("ArrowLeft", { altKey: true }), true, false, true), 1);
});

test("the tool a step lands on goes round past the ends", () => {
  const ids = ["a", "b", "c"];
  assert.equal(stepTool(ids, "b", 1), "c");
  assert.equal(stepTool(ids, "c", 1), "a");
  assert.equal(stepTool(ids, "a", -1), "c");
  assert.equal(stepTool(["a"], "a", 1), "a");
  // From a page not on the tool bar: the first tool, or the last.
  assert.equal(stepTool(ids, "settings", 1), "a");
  assert.equal(stepTool(ids, "settings", -1), "c");
  assert.equal(stepTool([], "a", 1), null);
});
