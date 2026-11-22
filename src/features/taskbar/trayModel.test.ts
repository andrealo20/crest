import { test } from "node:test";
import assert from "node:assert/strict";
import { demote, placeHidden, promote, shownSlot, splitTray } from "./trayModel.ts";

test("icons keep the order Andrea chose and the others go to the panel", () => {
  const i = (id: string) => ({ id, key: id, tip: id, img: null });
  assert.deepEqual(splitTray([i("a"), i("b"), i("c")], ["c", "x", "a"]), { visible: [i("c"), i("a")], hidden: [i("b")] });
});

test("two icons with one id follow the same choice", () => {
  const i = (key: string) => ({ id: "same", key, tip: key, img: null });
  assert.deepEqual(splitTray([i("1"), i("2")], ["same"]), { visible: [i("1"), i("2")], hidden: [] });
});

test("the panel lists the icons in the order Andrea chose there, then the new ones in Rust's order", () => {
  const i = (id: string) => ({ id, key: id, tip: id, img: null });
  const icons = [i("a"), i("b"), i("c"), i("d")];
  // "x" has no icon now; "d" is new; "a" is in both lists and stays on the bar.
  assert.deepEqual(splitTray(icons, ["a"], ["c", "x", "a", "b"]), { visible: [i("a")], hidden: [i("c"), i("b"), i("d")] });
  assert.deepEqual(splitTray(icons, [], []).hidden, icons);
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

test("an icon let go in the panel goes to that cell, and the saved ids with no icon now keep their places", () => {
  const i = (id: string) => ({ id, key: id, tip: id, img: null });
  // Saved "c", "x", "b"; "x" has no icon now and "d" was never moved, so the panel draws c, b, d.
  const hidden = [i("c"), i("b"), i("d")];
  // Within the panel: "d" before "c", "c" after "b".
  assert.deepEqual(placeHidden(["c", "x", "b"], [], hidden, "d", 0), ["d", "c", "x", "b"]);
  assert.deepEqual(placeHidden(["c", "x", "b"], [], hidden, "c", 2), ["x", "b", "c", "d"]);
  // From the bar: "a" was kept visible and saved in the panel once; it goes in at the cell, the end past the last.
  assert.deepEqual(placeHidden(["a", "c", "x", "b"], ["a"], hidden, "a", 1), ["c", "x", "a", "b", "d"]);
  assert.deepEqual(placeHidden([], ["a"], [], "a", 0), ["a"]);
});
