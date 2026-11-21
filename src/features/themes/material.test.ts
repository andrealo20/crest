import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  Hct,
  MaterialDynamicColors,
  SchemeMonochrome,
  SchemeTonalSpot,
  argbFromHex,
  argbFromRgb,
  hexFromArgb,
  labFromArgb,
} from "@material/material-color-utilities";
import { BLACK, contrast, isDark, over, parseColor, type Rgba } from "./color.ts";
import { materialInk, resolveMaterial } from "./material.ts";
import { BUILT_IN_THEMES, GRAPHIC, HUE_PALETTE, MODES, STRONG_TEXT, TERTIARY, TEXT, resolveTheme, type ThemeFile } from "./themes.ts";

const [dark, light] = BUILT_IN_THEMES;
const seeded = (t: ThemeFile, accent: string): ThemeFile => ({ ...t, id: `${t.id} seeded ${accent}`, colors: { ...t.colors, accent } });
/** Every built-in theme and a grey seed on each side, without and with the system's "more contrast". */
const CASES = [...BUILT_IN_THEMES, seeded(dark, "#9e9e9e"), seeded(light, "#9e9e9e")].flatMap((t) =>
  ([0, 1] as const).map((level) => ({ t, level, name: `${t.id}, contrast ${level}` })),
);
/** CIELAB chroma, in which a grey has none: HCT gives pure white 2.9, so it cannot tell Monochrome's white primary from a faint tint. */
const chroma = (hex: string) => {
  const [, a, b] = labFromArgb(argbFromHex(hex));
  return Math.hypot(a, b);
};

/** resolveTheme's minimums with `ground` under the panel's colours, each pair that misses named. */
function misses(vars: Record<string, string>, ground: Rgba): string[] {
  const c = (name: string) => parseColor(vars[name])!;
  const elevated = c("--color-elevated");
  const [fill1, fill2, fill3] = [1, 2, 3].map((n) => over(c(`--color-fill-${n}`), ground));
  const pairs: [string, number, Rgba[]][] = [
    ["--color-label", STRONG_TEXT, [ground, elevated]],
    ["--color-label", TEXT, [fill3]],
    ["--color-label-2", TEXT, [ground, elevated, fill1, fill2]],
    ["--color-label-3", TERTIARY, [ground, elevated, fill1]],
    ["--theme-accent", GRAPHIC, [ground, elevated]],
    ["--color-link", GRAPHIC, [ground, elevated]],
    ["--color-orange", TEXT, [ground]],
    ["--color-red", TEXT, [ground]],
    ["--color-green", TEXT, [ground]],
    ["--color-yellow", GRAPHIC, [ground]],
    ["--color-caution", TEXT, [ground, fill1]],
    ...Object.keys(HUE_PALETTE).map((hue): [string, number, Rgba[]] => [`--hue-${hue}`, GRAPHIC, [ground, elevated, fill1, fill3]]),
  ];
  return pairs.flatMap(([name, minimum, grounds]) =>
    grounds.filter((g) => contrast(c(name), g) < minimum).map((g) => `${name} ${contrast(c(name), g).toFixed(2)}:1 < ${minimum}`),
  );
}

test("Material: every built-in theme and a grey seed resolve with no correction to resolveTheme's 49 variables", () => {
  for (const { t, level, name } of CASES) {
    const m = resolveMaterial(t, { contrast: level });
    assert.deepEqual(m.adjustments, [], name);
    assert.deepEqual(Object.keys(m.vars), Object.keys(resolveTheme(t).vars), name);
    assert.equal(Object.keys(m.vars).length, 49, name);
  }
});

test("Material: the inks on the role fills, the status colours, the slider's track and the search's flash keep their minimums", () => {
  for (const { t, level, name } of CASES) {
    const m = resolveMaterial(t, { contrast: level });
    const c = (n: string) => parseColor(m.vars[n])!;
    // Orange, green and yellow on the panel, caution on the panel and on fill-1, among resolveTheme's other pairs.
    assert.deepEqual(misses(m.vars, m.colors.background), [], name);
    assert.ok(contrast(c("--color-on-primary"), c("--color-primary")) >= TEXT, `${name} on-primary`);
    assert.ok(contrast(c("--color-on-secondary-container"), c("--color-secondary-container")) >= TEXT, `${name} on-secondary-container`);
    // The slider's inactive track and the search's flash are fill-3 on the panel, beside primary and under the row's label.
    const fill3 = over(c("--color-fill-3"), m.colors.background);
    assert.ok(contrast(c("--color-primary"), fill3) >= GRAPHIC, `${name} primary beside fill-3`);
    assert.ok(contrast(c("--color-label"), fill3) >= TEXT, `${name} label on fill-3`);
  }
});

test("Material gives the scheme's tertiary role to drawing outside CSS and to --color-tertiary", () => {
  for (const { t, level, name } of CASES) {
    // The scheme rebuilt as resolveMaterial builds it, so the test does not read the role through the code under test.
    const dark = isDark(over(parseColor(t.colors.background) ?? BLACK, BLACK));
    const accent = parseColor(t.colors.accent) ?? parseColor(MODES[dark ? "dark" : "light"].accent)!;
    const source = Hct.fromInt(argbFromRgb(accent.r, accent.g, accent.b));
    const scheme = new (source.chroma < 8 ? SchemeMonochrome : SchemeTonalSpot)(source, dark, level);
    const m = resolveMaterial(t, { contrast: level });
    assert.equal(m.m3Tertiary, hexFromArgb(MaterialDynamicColors.tertiary.getArgb(scheme)), name);
    assert.equal(m.vars["--color-tertiary"], m.m3Tertiary, name);
  }
});

test("the primary and the tertiary read at 3:1 on a tile over the surface, for the weather's big temperature and the hardware's rings", () => {
  for (const { t, level, name } of CASES) {
    const c = (n: string) => parseColor(resolveMaterial(t, { contrast: level }).vars[n])!;
    assert.ok(contrast(c("--color-primary"), over(c("--color-fill-1"), c("--color-notch"))) >= GRAPHIC, name);
    assert.ok(contrast(c("--color-tertiary"), over(c("--color-fill-1"), c("--color-notch"))) >= GRAPHIC, `${name} tertiary`);
  }
});

test("Material: the closed notch's ink, the dark scheme of the same seed, keeps every minimum on black", () => {
  for (const { t, level, name } of CASES) {
    const ink = materialInk(t, { contrast: level });
    assert.equal(ink.dark, true, name);
    assert.deepEqual(misses(ink.vars, BLACK), [], name);
  }
});

test("Material: a seed under chroma 8 gives a grey scheme instead of a tint the theme never had", () => {
  for (const t of [seeded(dark, "#9e9e9e"), seeded(light, "#9e9e9e")]) assert.ok(chroma(resolveMaterial(t).vars["--color-primary"]) < 1, t.id);
  const primaryAt = (seedChroma: number) => chroma(resolveMaterial(seeded(dark, hexFromArgb(Hct.from(250, seedChroma, 50).toInt()))).vars["--color-primary"]);
  assert.ok(primaryAt(7) < 1);
  assert.ok(primaryAt(9) > 1);
});

test("Material: Dark's and Light's seeds give the design's colours, so a change of the library shows", () => {
  // [variable, Dark's seed, Light's seed] at contrast 0.
  const table: [string, string, string][] = [
    ["--color-notch", "#111318", "#f9f9ff"],
    ["--color-elevated", "#282a2f", "#ffffff"],
    ["--color-label", "#e2e2e9", "#191c20"],
    ["--color-label-2", "#c4c6d0", "#44474e"],
    ["--color-label-3", "#8e9099", "#74777f"],
    ["--color-label-4", "rgb(226 226 233 / 0.38)", "rgb(25 28 32 / 0.38)"],
    ["--color-fill-1", "rgb(226 226 233 / 0.06)", "rgb(25 28 32 / 0.04)"],
    ["--color-fill-2", "rgb(226 226 233 / 0.1)", "rgb(25 28 32 / 0.07)"],
    ["--color-fill-3", "rgb(226 226 233 / 0.16)", "rgb(25 28 32 / 0.12)"],
    ["--color-separator", "#44474e", "#c4c6d0"],
    ["--theme-accent", "#aac7ff", "#415e91"],
    ["--color-link", "#aac7ff", "#415e91"],
    ["--color-red", "#ffb4ab", "#ba1a1a"],
    ["--color-orange", "#ffb868", "#885200"],
    ["--color-yellow", "#e9c400", "#705d00"],
    ["--color-caution", "#e9c400", "#705d00"],
    ["--color-green", "#30e19b", "#006c47"],
    ["--color-black", "#000000", "#ffffff"],
    ["--notch-closed", "#000000", "#000000"],
    ["--color-primary", "#aac7ff", "#415e91"],
    ["--color-on-primary", "#09305f", "#ffffff"],
    ["--color-secondary-container", "#3e4759", "#dae2f9"],
    ["--color-on-secondary-container", "#dae2f9", "#3e4759"],
  ];
  const d = resolveMaterial(dark).vars, l = resolveMaterial(light).vars;
  assert.deepEqual(table.map(([name]) => [name, d[name], l[name]]), table);
});

test("Material: more contrast reaches the panel and the closed notch's ink", () => {
  // At contrast 0 Dark's primary is #aac7ff: a contrast option dropped on the way would give that.
  assert.equal(resolveMaterial(dark, { contrast: 1 }).vars["--color-primary"], "#ebf0ff");
  assert.equal(materialInk(dark, { contrast: 1 }).vars["--color-primary"], "#ebf0ff");
});

test("the colour library stays at exactly 0.3.0: another version can change every colour", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.dependencies["@material/material-color-utilities"], "0.3.0");
});
