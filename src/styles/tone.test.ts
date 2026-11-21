// The opacities of Material's button layers, read from global.css, against every built-in theme: on dark themes a white tone layer
// rises over the container instead of the state layer, which would darken it; on light ones the state layer stays.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hct, argbFromRgb } from "@material/material-color-utilities";
import { WHITE, contrast, over, parseColor, withAlpha, type Rgba } from "../features/themes/color.ts";
import { resolveMaterial } from "../features/themes/material.ts";
import { BUILT_IN_THEMES } from "../features/themes/themes.ts";

const css = readFileSync(join(import.meta.dirname, "global.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** A number declared in the block whose selector is exactly `selector`: the same property sits in more than one block. */
function declared(selector: string, name: string): number {
  for (const [, sel, body] of css.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    if (sel.trim().replace(/\s+/g, " ") !== selector) continue;
    const m = new RegExp(`${name}\\s*:\\s*([\\d.]+)\\s*;`).exec(body);
    if (m) return Number(m[1]);
  }
  throw new Error(`${name} not found in ${selector}`);
}

const ROOT = '[data-design="material"]';
const LIFT = '[data-design="material"][data-theme="dark"] .m3-lift';
const tonalHover = declared(LIFT, "--m3-tone-hover");
const tonalPress = declared(LIFT, "--m3-tone-press");
const filledHover = declared(`${LIFT}.m3-filled`, "--m3-tone-hover");
const filledPress = declared(`${LIFT}.m3-filled`, "--m3-tone-press");
const stateHover = declared(ROOT, "--m3-state-hover");
const statePress = declared(ROOT, "--m3-state-press");

const tone = (c: Rgba) => Hct.fromInt(argbFromRgb(c.r, c.g, c.b)).tone;
const TEXT = 4.5;

const CASES = BUILT_IN_THEMES.flatMap((t) => ([0, 1] as const).map((level) => ({ r: resolveMaterial(t, { contrast: level }), name: `${t.id}, contrast ${level}` })));

test("on dark themes the tonal button's tone rises at least 2 on hover, and its text keeps 4.5:1 hovered and pressed", () => {
  for (const { r, name } of CASES.filter((c) => c.r.dark)) {
    const c = parseColor(r.vars["--color-secondary-container"])!;
    const ink = parseColor(r.vars["--color-on-secondary-container"])!;
    const hover = over(withAlpha(WHITE, tonalHover), c);
    const press = over(withAlpha(WHITE, tonalPress), c);
    assert.ok(tone(hover) >= tone(c) + 2, `${name}: hover rises ${(tone(hover) - tone(c)).toFixed(2)}`);
    assert.ok(contrast(ink, hover) >= TEXT, `${name}: hover ${contrast(ink, hover).toFixed(2)}`);
    assert.ok(contrast(ink, press) >= TEXT, `${name}: press ${contrast(ink, press).toFixed(2)}`);
    assert.ok(tone(press) >= tone(hover), `${name}: press below hover`);
  }
});

test("on dark themes the filled button's tone rises on hover and press, and its text keeps 4.5:1", () => {
  for (const { r, name } of CASES.filter((c) => c.r.dark)) {
    const c = parseColor(r.vars["--color-primary"])!;
    const ink = parseColor(r.vars["--color-on-primary"])!;
    for (const [state, alpha] of [["hover", filledHover], ["press", filledPress]] as const) {
      const g = over(withAlpha(WHITE, alpha), c);
      assert.ok(tone(g) >= tone(c) + 0.5, `${name}: ${state} rises ${(tone(g) - tone(c)).toFixed(2)}`);
      assert.ok(contrast(ink, g) >= TEXT, `${name}: ${state} ${contrast(ink, g).toFixed(2)}`);
    }
  }
});

test("on light themes the state layer leaves both buttons' text at 4.5:1", () => {
  const light = CASES.filter((c) => !c.r.dark);
  assert.ok(light.length > 0);
  for (const { r, name } of light)
    for (const [fill, text] of [["primary", "on-primary"], ["secondary-container", "on-secondary-container"]]) {
      const c = parseColor(r.vars[`--color-${fill}`])!;
      const ink = parseColor(r.vars[`--color-${text}`])!;
      for (const alpha of [stateHover, statePress]) {
        const g = over(withAlpha(ink, alpha), c);
        assert.ok(contrast(ink, g) >= TEXT, `${name} ${fill} at ${alpha}: ${contrast(ink, g).toFixed(2)}`);
      }
    }
});
