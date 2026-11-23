import { test } from "node:test";
import assert from "node:assert/strict";
import { WALLPAPER_DEFAULTS, baseName, dueIn, normalizeWallpapers } from "./model.ts";

test("the wallpapers' settings: what is known is kept, anything else takes its default", () => {
  assert.deepEqual(WALLPAPER_DEFAULTS, { source: "crest", folder: "", fit: "fill", every: 0 });
  for (const v of [undefined, null, "x", [], 3]) assert.deepEqual(normalizeWallpapers(v), WALLPAPER_DEFAULTS);
  const saved = { source: "folder", folder: "D:\\Bilder", fit: "span", every: 60 };
  assert.deepEqual(normalizeWallpapers(saved), saved);
  assert.equal(normalizeWallpapers({ every: 30 }).every, 0);
  assert.equal(normalizeWallpapers({ fit: "tile" }).fit, "fill");
  assert.equal(normalizeWallpapers({ folder: 3 }).folder, "");
  assert.equal(normalizeWallpapers({ source: "web" }).source, "crest");
});

test("the automatic change waits its interval from the last change, never longer, and is due at once when late", () => {
  const MIN = 60_000;
  assert.equal(dueIn(1000, 0, 5000), null);
  assert.equal(dueIn(0, 15, 1000), 15 * MIN);
  assert.equal(dueIn(1000, 15, 1000 + 5 * MIN), 10 * MIN);
  assert.equal(dueIn(1000, 60, 1000 + 61 * MIN), 0);
  // A clock set back: the change made "later" waits one interval, not until then.
  assert.equal(dueIn(10 * 1440 * MIN, 1440, 1000), 1440 * MIN);
});

test("a picture's or a folder's name, on Windows and on a Mac", () => {
  assert.equal(baseName("D:\\Bilder\\Berge.jpg"), "Berge.jpg");
  assert.equal(baseName("D:\\Bilder\\"), "Bilder");
  assert.equal(baseName("/Users/a/Pictures/"), "Pictures");
  assert.equal(baseName("C:\\"), "C:");
  assert.equal(baseName("/"), "/");
});
