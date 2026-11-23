import { test } from "node:test";
import assert from "node:assert/strict";
import { WALLPAPER_DEFAULTS, normalizeWallpapers } from "./model.ts";

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
