import { test } from "node:test";
import assert from "node:assert/strict";
import { FOLDER_NAME_MAX, folderKey, normalizeFolders } from "./folderModel.ts";

const pinned = ["a", "b", "c", "d"].map((id) => ({ id, name: id.toUpperCase() }));

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
