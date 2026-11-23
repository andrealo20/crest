import { test } from "node:test";
import assert from "node:assert/strict";
import { FOLDER_NAME_MAX, FOLDER_REST, dropOnBar, folderGrid, folderKey, gridKey, intoFolder, moveInFolder, newFolder, nextName, normalizeFolders, pinBefore, pinOver, renameFolder, takeOut, ungroup, type Folder, type Pins } from "./folderModel.ts";
import { movePinned } from "./model.ts";

const pinned = ["a", "b", "c", "d"].map((id) => ({ id, name: id.toUpperCase() }));
const pins = (ids: string[], folders: Folder[] = []): Pins => ({ pinned: ids.map((id) => ({ id, name: id.toUpperCase() })), folders });
const ids = (p: Pins) => p.pinned.map((f) => f.id);

test("saved folders: nothing from garbage or before any app was pinned", () => {
  for (const v of [undefined, null, "x", 3, {}]) assert.deepEqual(normalizeFolders(v, pinned), []);
  assert.deepEqual(normalizeFolders([{ id: "f", name: "", apps: ["a"] }], null), []);
});

test("a folder keeps only pinned apps, each in one folder, the first; empty folders and repeated ids go, one app is enough", () => {
  const saved = [
    { id: "f1", name: "Work", apps: ["a", "x", "b", "a"] },
    { id: "f2", name: "Play", apps: ["b", "c"] },
    { id: "f1", name: "Twice", apps: ["d"] },
    { id: "", name: "No id", apps: ["d"] },
    { id: "f3", name: "Gone", apps: ["x"] },
    { id: "f4", name: "One", apps: ["d", 4] },
    "junk",
  ];
  assert.deepEqual(normalizeFolders(saved, pinned), [
    { id: "f1", name: "Work", apps: ["a", "b"] },
    { id: "f2", name: "Play", apps: ["c"] },
    { id: "f4", name: "One", apps: ["d"] },
  ]);
});

test("a folder's name is trimmed and cut to 40 characters, and is empty when it is not a string", () => {
  const long = "x".repeat(50);
  assert.deepEqual(normalizeFolders([{ id: "f", name: `  ${long}  `, apps: ["a"] }], pinned)[0].name, "x".repeat(FOLDER_NAME_MAX));
  assert.equal(normalizeFolders([{ id: "f", name: 3, apps: ["a"] }], pinned)[0].name, "");
  assert.equal(normalizeFolders([{ id: "f", apps: "a" }], pinned).length, 0);
  assert.equal(folderKey("f1"), "folder:f1");
});

test("a new folder is called Folder, then Folder 2, Folder 3 while the name is taken", () => {
  const label = (n: number) => (n === 1 ? "Folder" : `Folder ${n}`);
  assert.equal(nextName([], label), "Folder");
  assert.equal(nextName([{ id: "f", name: "Folder", apps: ["a"] }], label), "Folder 2");
  // An unnamed folder is drawn as Folder, so it takes that name too.
  assert.equal(nextName([{ id: "f", name: "", apps: ["a"] }, { id: "g", name: "Folder 2", apps: ["b"] }], label), "Folder 3");
  assert.equal(nextName([{ id: "f", name: "Folder 2", apps: ["a"] }], label), "Folder");
});

test("a folder's button has four mini icons, two by two, with a gap round them that grows with it", () => {
  assert.deepEqual([16, 20, 24, 40].map(folderGrid), [{ mini: 6, pad: 1 }, { mini: 8, pad: 1 }, { mini: 9, pad: 2 }, { mini: 15, pad: 3 }]);
});

test("an app held over the middle half of another place is over it, never over its own, and a folder dragged is over nothing", () => {
  const slots = [{ id: "a", x: 100, w: 40 }, { id: "folder:f", x: 146, w: 40 }, { id: "c", x: 192, w: 40 }];
  assert.equal(pinOver(slots, "c", 120), "a");
  assert.equal(pinOver(slots, "c", 110), "a");
  assert.equal(pinOver(slots, "c", 130), "a");
  // The quarters at the edges are for the line.
  assert.equal(pinOver(slots, "c", 109), null);
  assert.equal(pinOver(slots, "c", 131), null);
  assert.equal(pinOver(slots, "a", 166), "folder:f");
  assert.equal(pinOver(slots, "a", 120), null);
  assert.equal(pinOver(slots, "folder:f", 120), null);
  assert.equal(FOLDER_REST, 500);
});

test("a new folder holds the app alone at its place, and one from another folder right after that folder", () => {
  const p = pins(["a", "b", "c"]);
  const n = newFolder(p, "b", "f", "F");
  assert.deepEqual(ids(n), ["a", "b", "c"]);
  assert.deepEqual(n.folders, [{ id: "f", name: "F", apps: ["b"] }]);
  // On the bar: [G (a, b), c, d], then [G (b), F (a), c, d].
  const q = pins(["a", "b", "c", "d"], [{ id: "g", name: "G", apps: ["a", "b"] }]);
  const m = newFolder(q, "a", "f", "F");
  assert.deepEqual(m.folders, [{ id: "g", name: "G", apps: ["b"] }, { id: "f", name: "F", apps: ["a"] }]);
  assert.deepEqual(ids(m), ["b", "a", "c", "d"]);
  assert.equal(newFolder(p, "x", "f", "F"), p);
});

test("an app held on another makes a folder of the two at the other's place, the one below first", () => {
  const p = pins(["a", "b", "c", "d"]);
  const n = intoFolder(p, "d", "b", "f", "F");
  assert.deepEqual(n.folders, [{ id: "f", name: "F", apps: ["b", "d"] }]);
  assert.deepEqual(ids(n), ["a", "b", "d", "c"]);
  // From before the target, too: the folder stays at the target's place.
  const before = intoFolder(p, "a", "c", "f", "F");
  assert.deepEqual(ids(before), ["b", "c", "a", "d"]);
  assert.deepEqual(before.folders, [{ id: "f", name: "F", apps: ["c", "a"] }]);
  // Held on a folder, it goes in at the end.
  const m = intoFolder(n, "a", folderKey("f"), "x", "X");
  assert.deepEqual(m.folders, [{ id: "f", name: "F", apps: ["b", "d", "a"] }]);
  assert.deepEqual(ids(m), ["b", "d", "a", "c"]);
  // From another folder, it leaves that one, which goes once empty.
  const q = pins(["a", "b", "c"], [{ id: "g", name: "G", apps: ["a"] }, { id: "h", name: "H", apps: ["b"] }]);
  const r = intoFolder(q, "a", folderKey("h"), "x", "X");
  assert.deepEqual(r.folders, [{ id: "h", name: "H", apps: ["b", "a"] }]);
  assert.deepEqual(ids(r), ["b", "a", "c"]);
  // On itself, on its own folder, or on what is not there: the same object.
  assert.equal(intoFolder(p, "b", "b", "f", "F"), p);
  assert.equal(intoFolder(m, "a", folderKey("f"), "x", "X"), m);
  assert.equal(intoFolder(p, "a", folderKey("nope"), "x", "X"), p);
  assert.equal(intoFolder(p, "a", "nope", "x", "X"), p);
});

test("an app taken out of its folder goes right after it, or before the place it is dropped on", () => {
  // On the bar: [F (a, b), c, d].
  const p = pins(["a", "b", "c", "d"], [{ id: "f", name: "F", apps: ["a", "b"] }]);
  const n = takeOut(p, "a");
  assert.deepEqual(n.folders, [{ id: "f", name: "F", apps: ["b"] }]);
  assert.deepEqual(ids(n), ["b", "a", "c", "d"]);
  assert.deepEqual(ids(takeOut(p, "b", "d")), ["a", "c", "b", "d"]);
  assert.deepEqual(ids(takeOut(p, "b", null)), ["a", "c", "d", "b"]);
  // Before a folder's key: before that folder.
  const q = pins(["a", "b", "c", "d"], [{ id: "f", name: "F", apps: ["a", "b"] }, { id: "g", name: "G", apps: ["d"] }]);
  assert.deepEqual(ids(takeOut(q, "a", folderKey("g"))), ["b", "c", "a", "d"]);
  // The last app out: the folder goes, the app keeps its place.
  const r = takeOut(n, "b");
  assert.deepEqual(r.folders, []);
  assert.deepEqual(ids(r), ["b", "a", "c", "d"]);
  // In no folder, or before what is not there: the same object.
  assert.equal(takeOut(p, "c"), p);
  assert.equal(takeOut(p, "a", "nope"), p);
});

test("an app moves inside its folder, the folder keeps its place, and its own place changes nothing", () => {
  const p = pins(["x", "a", "b", "c"], [{ id: "f", name: "F", apps: ["a", "b", "c"] }]);
  assert.deepEqual(moveInFolder(p, "c", 0).folders[0].apps, ["c", "a", "b"]);
  assert.deepEqual(moveInFolder(p, "a", 3).folders[0].apps, ["b", "c", "a"]);
  assert.deepEqual(moveInFolder(p, "a", 2).folders[0].apps, ["b", "a", "c"]);
  assert.equal(moveInFolder(p, "c", 0).pinned, p.pinned);
  assert.equal(moveInFolder(p, "b", 1), p);
  assert.equal(moveInFolder(p, "b", 2), p);
  assert.equal(moveInFolder(p, "x", 0), p);
});

test("a drop on the bar moves a folder's apps as a block, takes an app out of its folder, or moves a pin", () => {
  // On the bar: [F (b, a), c, d].
  const p = pins(["a", "b", "c", "d"], [{ id: "f", name: "F", apps: ["b", "a"] }]);
  const n = dropOnBar(p, folderKey("f"), null);
  assert.deepEqual(ids(n), ["c", "d", "b", "a"]);
  assert.deepEqual(n.folders, p.folders);
  assert.deepEqual(ids(dropOnBar(p, folderKey("f"), "d")), ["c", "b", "a", "d"]);
  const m = dropOnBar(p, "a", "d");
  assert.deepEqual(m.folders, [{ id: "f", name: "F", apps: ["b"] }]);
  assert.deepEqual(ids(m), ["b", "c", "a", "d"]);
  assert.deepEqual(ids(dropOnBar(p, "d", folderKey("f"))), ["d", "b", "a", "c"]);
  // Its own place, or either not there: the same object.
  assert.equal(dropOnBar(p, folderKey("f"), "c"), p);
  assert.equal(dropOnBar(p, "c", "d"), p);
  assert.equal(dropOnBar(p, "x", "d"), p);
  assert.equal(dropOnBar(p, "c", "x"), p);
  // Without folders it is movePinned.
  const flat = pins(["a", "b", "c"]);
  for (const [id, before] of [["c", "a"], ["a", "c"], ["a", null]] as const) assert.deepEqual(dropOnBar(flat, id, before).pinned, movePinned(flat.pinned, id, before));
});

test("ungrouping puts a folder's apps back at its place in its order", () => {
  const p = pins(["x", "a", "b", "c"], [{ id: "f", name: "F", apps: ["b", "a"] }, { id: "g", name: "G", apps: ["c"] }]);
  const n = ungroup(p, "f");
  assert.deepEqual(ids(n), ["x", "b", "a", "c"]);
  assert.deepEqual(n.folders, [{ id: "g", name: "G", apps: ["c"] }]);
  assert.equal(ungroup(p, "nope"), p);
});

test("a folder's new name is trimmed and cut, and an unchanged one gives the same list", () => {
  const folders = [{ id: "f", name: "F", apps: ["a"] }];
  assert.deepEqual(renameFolder(folders, "f", "  Work  "), [{ id: "f", name: "Work", apps: ["a"] }]);
  assert.equal(renameFolder(folders, "f", "x".repeat(50))[0].name, "x".repeat(FOLDER_NAME_MAX));
  assert.equal(renameFolder(folders, "f", " F "), folders);
  assert.equal(renameFolder(folders, "g", "G"), folders);
});

test("files dropped before a folder go before its first app in the pinned list", () => {
  const p = pins(["a", "b", "c"], [{ id: "f", name: "F", apps: ["c", "b"] }]);
  assert.equal(pinBefore(p, folderKey("f")), "b");
  assert.equal(pinBefore(p, "a"), "a");
  assert.equal(pinBefore(p, null), null);
  assert.equal(pinBefore(p, folderKey("x")), null);
});

test("the arrows step through a grid, a row at a time up and down, mirrored right to left, without wrapping", () => {
  // Seven cells, five to a row: 0 1 2 3 4 / 5 6.
  assert.equal(gridKey("ArrowRight", 0, 7, 5, false), 1);
  assert.equal(gridKey("ArrowRight", 4, 7, 5, false), 5);
  assert.equal(gridKey("ArrowRight", 6, 7, 5, false), 6);
  assert.equal(gridKey("ArrowLeft", 0, 7, 5, false), 0);
  assert.equal(gridKey("ArrowLeft", 1, 7, 5, true), 2);
  assert.equal(gridKey("ArrowRight", 1, 7, 5, true), 0);
  assert.equal(gridKey("ArrowDown", 1, 7, 5, false), 6);
  // Into the short last row: its last cell.
  assert.equal(gridKey("ArrowDown", 3, 7, 5, false), 6);
  assert.equal(gridKey("ArrowDown", 6, 7, 5, false), 6);
  assert.equal(gridKey("ArrowUp", 6, 7, 5, false), 1);
  assert.equal(gridKey("ArrowUp", 2, 7, 5, false), 2);
  assert.equal(gridKey("Home", 4, 7, 5, false), 0);
  assert.equal(gridKey("End", 0, 7, 5, false), 6);
  assert.equal(gridKey("Enter", 0, 7, 5, false), undefined);
  assert.equal(gridKey("ArrowDown", 0, 0, 5, false), undefined);
});
