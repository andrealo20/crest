import { test } from "node:test";
import assert from "node:assert/strict";
import { GLASS_GLSL, MAIN_FS } from "./shader.ts";
import { BAR_FS, MAX_RECTS } from "../../features/taskbar/window/glassShader.ts";

test("the notch's shader takes the shared glass functions once", () => {
  for (const name of ["float sdRound(", "vec2 bend(", "float shine(", "float luma("]) {
    assert.equal(MAIN_FS.split(name).length, 2, name);
    assert.equal(BAR_FS.split(name).length, 2, name);
  }
  assert.ok(MAIN_FS.includes(GLASS_GLSL) && BAR_FS.includes(GLASS_GLSL));
  assert.ok(BAR_FS.includes(`uRects[${MAX_RECTS}]`));
});
