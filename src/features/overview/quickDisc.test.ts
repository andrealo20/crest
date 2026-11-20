import { test } from "node:test";
import assert from "node:assert/strict";
import { discLook } from "./quickDisc.ts";
import { HUE_PALETTE } from "../themes/themes.ts";

test("Crest lights a quick switch in its hue, with a white icon and no pressed corners", () => {
  const look = discLook("crest", "violet", true);
  assert.equal(look.style?.background, HUE_PALETTE.violet[1]);
  assert.match(look.className, /\btext-white\b/);
  assert.doesNotMatch(look.className, /\bm3-morph\b/);
});

test("Material lights a quick switch in the primary colour, with the pressed corners", () => {
  const look = discLook("material", "violet", true);
  assert.equal(look.style, undefined);
  for (const c of ["bg-primary", "text-on-primary", "m3-morph"]) assert.match(look.className, new RegExp(`(^|\\s)${c}(\\s|$)`));
});

test("the muted microphone stays red under Material", () => {
  const look = discLook("material", "red", true);
  assert.equal(look.style?.background, HUE_PALETTE.red[1]);
  assert.match(look.className, /\btext-white\b/);
});

test("an off switch is the same grey disc in both styles", () => {
  for (const design of ["crest", "material"] as const) {
    for (const hue of ["violet", "red", "blue"] as const) {
      const look = discLook(design, hue, false);
      assert.equal(look.style, undefined);
      assert.match(look.className, /(^|\s)bg-fill-2(\s|$)/);
      assert.match(look.className, /(^|\s)text-label-2(\s|$)/);
    }
  }
});
