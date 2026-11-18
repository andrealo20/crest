import { test } from "node:test";
import assert from "node:assert/strict";
import { demote, promote, shownSlot, splitTray } from "./trayModel.ts";

test("icons keep the order Andrea chose and the others go to the panel", () => {
  const i = (id: string) => ({ id, key: id, tip: id, img: null });
  assert.deepEqual(splitTray([i("a"), i("b"), i("c")], ["c", "x", "a"]), { visible: [i("c"), i("a")], hidden: [i("b")] });
});

test("two icons with one id follow the same choice", () => {
  const i = (key: string) => ({ id: "same", key, tip: key, img: null });
  assert.deepEqual(splitTray([i("1"), i("2")], ["same"]), { visible: [i("1"), i("2")], hidden: [] });
});

test("promoting at a slot inserts or moves an icon", () => {
  assert.deepEqual(promote(["a", "b"], "c", 1), ["a", "c", "b"]);
  assert.deepEqual(promote(["a", "b", "c"], "c", 0), ["c", "a", "b"]);
});

test("demoting removes an icon and keeps the others in order", () => {
  assert.deepEqual(demote(["a", "b", "c"], "b"), ["a", "c"]);
  assert.deepEqual(demote(["a"], "x"), ["a"]);
});

test("a gap on the bar is the place before its icon among the kept ids, past ids that have no icon now", () => {
  const i = (id: string) => ({ id, key: id, tip: id, img: null });
  // "x" is kept visible, but its program does not run.
  const shown = ["a", "x", "b"];
  const visible = [i("a"), i("b")];
  assert.deepEqual([0, 1, 2].map((slot) => shownSlot(shown, visible, slot)), [0, 2, 3]);
  // A slot counts the icon's own place, as the bar shows it: moved right, an icon lands before the slot's icon.
  assert.deepEqual(promote(["a", "b", "c"], "a", 2), ["b", "a", "c"]);
  assert.deepEqual(promote(["a", "b", "c"], "a", 1), ["a", "b", "c"]);
  assert.deepEqual(promote(shown, "a", shownSlot(shown, visible, 2)), ["x", "b", "a"]);
});
