import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLACK, WHITE, contrast, formatColor, over, parseColor, withAlpha, type Rgba } from "./color.ts";
import {
  BUILT_IN_THEMES,
  EDITOR_KEYS,
  FONTS,
  GLASS_EDGE,
  GRAPHIC,
  HUE_PALETTE,
  STRONG_TEXT,
  TERTIARY,
  TEXT,
  THEME_DEFAULTS,
  captionSpacing,
  closedGlassInk,
  editorKeys,
  findTheme,
  fontStack,
  glassInk,
  glassVeil,
  glassVeilAt,
  importThemes,
  isBuiltIn,
  normalizeId,
  normalizeThemeSettings,
  parseThemeText,
  plusInk,
  readableAccent,
  resolveTheme,
  setThemeColor,
  systemTheme,
  takenIds,
  themeChoices,
  themeToText,
  uniqueId,
  validateTheme,
  type ResolvedTheme,
  type ThemeFile,
} from "./themes.ts";
import { resolveMaterial } from "./material.ts";

const dark = BUILT_IN_THEMES[0];
const light = BUILT_IN_THEMES[1];

test("every built-in theme passes the readability rules as written", () => {
  for (const t of BUILT_IN_THEMES) assert.deepEqual(resolveTheme(t).adjustments, [], t.id);
  assert.deepEqual(
    BUILT_IN_THEMES.map((t) => t.id),
    [
      "dark",
      "light",
      "one-dark-pro",
      "github-dark",
      "github-light",
      "dracula",
      "night-owl",
      "catppuccin-mocha",
      "catppuccin-latte",
      "nord",
      "rose-pine",
      "rose-pine-dawn",
      "gruvbox-dark",
      "solarized-light",
      "everforest",
    ],
  );
});

test("built-in themes keep the closed notch black", () => {
  for (const t of BUILT_IN_THEMES) assert.equal(resolveTheme(t).vars["--notch-closed"], "#000000", t.id);
  assert.equal(resolveTheme({ ...light, id: "x", closedNotch: "background" }).vars["--notch-closed"], "#fafafc");
});

test("Dark resolves to exactly the tokens in tokens.css", () => {
  const css = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");
  const vars = resolveTheme(dark).vars;
  const tokens = [...css.matchAll(/(--color-[\w-]+):\s*([^;]+);/g)].filter(([, name]) => name !== "--color-accent");
  assert.ok(tokens.length >= 15);
  for (const [, name, value] of tokens) {
    const want = parseColor(value)!;
    const got = parseColor(vars[name]);
    assert.ok(got, `${name} missing`);
    assert.deepEqual({ ...got, a: Math.round(got.a * 1000) }, { ...want, a: Math.round(want.a * 1000) }, name);
  }
});

test("Crest style: every theme resolves to the recorded variables", () => {
  // Recorded before the Material style, in a file the resolver cannot rewrite: the Crest style must keep every colour.
  const recorded: Record<string, Record<string, string>> = JSON.parse(readFileSync(new URL("./crest-vars.fixture.json", import.meta.url), "utf8"));
  // The only variables the Material style may add: its role tokens, which repeat colours Crest already paints.
  const roles = ["--color-primary", "--color-on-primary", "--color-secondary-container", "--color-on-secondary-container", "--color-tertiary"];
  assert.deepEqual(Object.keys(recorded).sort(), BUILT_IN_THEMES.map((t) => t.id).sort());
  for (const t of BUILT_IN_THEMES) {
    const vars = resolveTheme(t).vars, want = recorded[t.id];
    for (const [name, value] of Object.entries(want)) assert.equal(vars[name], value, `${t.id} ${name}`);
    const known = new Set([...Object.keys(want), ...roles]);
    assert.deepEqual(Object.keys(vars).filter((name) => !known.has(name)), [], `${t.id}: variables not recorded`);
  }
});

test("Crest style: the five role tokens repeat label, black, fill-3, label and label", () => {
  for (const t of BUILT_IN_THEMES) {
    const v = resolveTheme(t).vars;
    assert.deepEqual(
      [v["--color-primary"], v["--color-on-primary"], v["--color-secondary-container"], v["--color-on-secondary-container"], v["--color-tertiary"]],
      [v["--color-label"], v["--color-black"], v["--color-fill-3"], v["--color-label"], v["--color-label"]],
      t.id,
    );
  }
});

test("forced colours list every colour token", () => {
  const tokens = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");
  const css = readFileSync(new URL("./themes.css", import.meta.url), "utf8");
  // The block ends at the first brace in the first column: the rules inside it are indented.
  const block = /@media \(forced-colors: active\) \{([\s\S]*?)\n\}/.exec(css)![1];
  // Without !important the inline theme on <html> wins and the row does nothing.
  const forced = new Set([...block.matchAll(/(--[\w-]+):[^;]*!important;/g)].map(([, name]) => name));
  const names = [...tokens.matchAll(/(--color-[\w-]+):\s*([^;]+);/g)];
  assert.ok(names.length >= 16);
  // --color-accent only points at --accent, so the row for --accent covers it.
  for (const [, name, value] of names) assert.ok(forced.has(/^var\((--[\w-]+)\)$/.exec(value)?.[1] ?? name), `${name} has no forced colour`);
});

test("light themes flip the ink on label fills", () => {
  assert.equal(resolveTheme(dark).vars["--color-black"], "#000000");
  assert.equal(resolveTheme(light).vars["--color-black"], "#ffffff");
  assert.equal(resolveTheme(light).dark, false);
});

test("a file of a few colours is a complete theme, and a weak colour is corrected", () => {
  const r = resolveTheme({ format: 1, id: "pale", name: "Pale", colors: { background: "#ffffff", warning: "#ffd60a" } });
  assert.equal(r.dark, false);
  assert.equal(r.vars["--color-label"], "#1d1d1f");
  const warn = parseColor(r.vars["--color-orange"])!;
  assert.ok(contrast(warn, parseColor("#ffffff")!) >= 4.5);
  assert.deepEqual(
    r.adjustments.map((a) => [a.key, a.from, a.met]),
    [["warning", "#ffd60a", true]],
  );
  // A translucent background is laid over black.
  assert.equal(resolveTheme({ format: 1, id: "t", name: "T", colors: { background: "#ffffff00" } }).vars["--color-notch"], "#000000");
});

test("fills, separator and label-4 follow the corrected foreground", () => {
  const r = resolveTheme({ format: 1, id: "dim", name: "Dim", colors: { background: "#000000", foreground: "#333333" } });
  const fg = parseColor(r.vars["--color-label"])!;
  assert.notEqual(fg.r, 0x33);
  for (const name of ["--color-fill-1", "--color-fill-3", "--color-separator", "--color-label-4"]) assert.equal(parseColor(r.vars[name])!.r, fg.r, name);
});

test("Dark keeps Crest's idle accent and its own link colour", () => {
  const v = resolveTheme(dark).vars;
  assert.equal(v["--theme-accent"], "#0a84ff");
  assert.equal(v["--color-link"], "#419cff");
  // Without a written link, links follow the accent.
  assert.equal(resolveTheme(light).vars["--color-link"], "#0066cc");
});

test("readable accent: unchanged on black, darkened on a light panel", () => {
  const onDark = resolveTheme(dark);
  assert.equal(readableAccent("hsl(60 90% 70%)", onDark), "hsl(60 90% 70%)");
  const fixed = readableAccent("hsl(60 90% 70%)", resolveTheme(light));
  assert.ok(contrast(parseColor(fixed)!, parseColor("#fafafc")!) >= 3);
  assert.equal(readableAccent("not a colour", onDark), "not a colour");
});

test("setThemeColor re-derives from a new background or foreground", () => {
  const odp = findTheme("one-dark-pro", []);
  const next = setThemeColor(odp, "background", parseColor("#101010")!);
  assert.equal(next.colors.background, "#101010");
  assert.equal(next.colors.secondary, undefined);
  assert.equal(next.colors.elevated, undefined);
  assert.equal(next.colors.foreground, odp.colors.foreground);
  // Dark to light with a light foreground: the foreground follows.
  const flipped = setThemeColor(odp, "background", parseColor("#f4f4f4")!);
  assert.equal(flipped.colors.foreground, "#1d1d1f");
  // A translucent foreground keeps its opacity; the accent leaves everything else alone.
  assert.equal(setThemeColor(dark, "foreground", parseColor("#ff0000")!).colors.foreground, "#ff0000f5");
  assert.equal(setThemeColor(dark, "accent", parseColor("#00ff00")!).colors.link, undefined);
  const accent = setThemeColor(odp, "accent", parseColor("#00ff00")!);
  assert.equal(accent.colors.secondary, odp.colors.secondary);
});

test("ids", () => {
  assert.equal(normalizeId("  Midnight Teal! "), "midnight-teal");
  assert.equal(normalizeId("..x.."), "x");
  assert.equal(normalizeId("a..b"), "a.b");
  assert.equal(normalizeId("a".repeat(80)).length, 64);
  assert.equal(normalizeId(undefined), "");
  assert.equal(uniqueId("Dark", new Set(["dark", "dark-2"])), "dark-3");
  assert.equal(uniqueId("", new Set()), "theme");
  // Names Windows reserves for devices get a suffix, so the file can be written.
  assert.equal(normalizeId("Nul"), "nul-theme");
  assert.equal(normalizeId("com1.x"), "com1-theme.x");
  assert.equal(normalizeId("console"), "console");
  assert.equal(normalizeId("com0"), "com0");
});

test("a name without latin letters still makes an id", () => {
  assert.equal(validateTheme({ name: "ダーク", colors: {} }).theme?.id, "theme");
  assert.equal(validateTheme({ id: "", name: "Mine", colors: {} }).theme?.id, "mine");
  assert.equal(validateTheme({ name: "", colors: {} }).theme, null);
});

test("theme file validation", () => {
  const ok = validateTheme({ format: 1, name: "Midnight teal", colors: { background: "#04161A", accent: "#2DD4BF" }, extra: 1 });
  assert.ok(ok.theme);
  assert.equal(ok.theme.id, "midnight-teal");
  assert.equal("extra" in ok.theme, false);
  const keys = (x: unknown) => validateTheme(x).problems.map((p) => p.key);
  assert.deepEqual(keys([]), ["Keine Theme-Datei: ein JSON-Objekt erwartet"]);
  assert.deepEqual(keys({ name: "x" }), ["„colors“ fehlt oder ist kein Objekt"]);
  assert.deepEqual(keys({ name: "x", colors: { foregound: "#fff" } }), ["Unbekannte Farbe „{key}“"]);
  assert.deepEqual(keys({ name: "x", colors: { accent: "blue" } }), ["„{key}“ ist keine Farbe: {value}"]);
  assert.deepEqual(keys({ format: 2, name: "x", colors: {} }), ["Format {n} ist neuer als diese Version von Crest"]);
  assert.deepEqual(keys({ colors: {} }), ["Name oder ID fehlt"]);
  assert.deepEqual(keys({ name: "x", colors: {}, closedNotch: "white" }), ["„closedNotch“ muss „black“ oder „background“ sein"]);
  assert.equal(validateTheme({ name: "x", colors: {}, closedNotch: "background" }).theme?.closedNotch, "background");
});

test("theme file text: JSON, size, round trip", () => {
  assert.equal(parseThemeText("{").problems[0].key, "Kein gültiges JSON: {error}");
  assert.equal(parseThemeText(" ".repeat(70_000)).problems[0].key, "Datei größer als 64 KB");
  for (const t of BUILT_IN_THEMES) assert.deepEqual(parseThemeText(themeToText(t)).theme, t);
});

test("import adds, never replaces, and skips what is already there", () => {
  const mine: ThemeFile = { format: 1, id: "mine", name: "Mine", colors: { accent: "#ff0000" } };
  const r = importThemes(
    [mine],
    [
      { file: "a.json", text: JSON.stringify({ name: "New one", colors: {} }) },
      { file: "b.json", text: JSON.stringify({ id: "mine", name: "Mine", colors: { accent: "#00ff00" } }) },
      { file: "b2.json", text: JSON.stringify({ id: "mine", name: "Mine", colors: { accent: "#FF0000" } }) },
      { file: "c.json", text: JSON.stringify({ id: "dark", name: "Fake", colors: {} }) },
      { file: "dark.json", text: themeToText(BUILT_IN_THEMES[0]) },
      { file: "d.json", text: "nope" },
      { file: "e.json", error: "Datei größer als 64 KB" },
    ],
  );
  // The old export of "mine" with other colours comes in beside it; the equal one is skipped, as is Dark's own export.
  assert.deepEqual(r.added.map((t) => t.id), ["new-one", "mine-2"]);
  assert.equal(r.unchanged, 2);
  assert.deepEqual(r.failed.map((f) => f.file), ["c.json", "d.json", "e.json"]);
  assert.deepEqual(r.custom.map((t) => [t.id, t.colors.accent]), [["mine", "#ff0000"], ["new-one", undefined], ["mine-2", "#00ff00"]]);
  // Importing the same folder again adds nothing.
  assert.deepEqual(importThemes(r.custom, [{ file: "b.json", text: JSON.stringify({ id: "mine", name: "Mine", colors: { accent: "#00ff00" } }) }]).added, []);
});

test("settings normalisation", () => {
  assert.deepEqual(normalizeThemeSettings(undefined), THEME_DEFAULTS);
  const s = normalizeThemeSettings({
    id: "mine",
    custom: [{ id: "mine", name: "Mine", colors: {} }, { id: "mine", name: "Again", colors: {} }, { id: "dark", name: "X", colors: {} }, { bad: true }],
    schedule: { on: true, dayStart: "25:00", nightStart: "21:30" },
  });
  assert.deepEqual(s.custom.map((t) => t.name), ["Mine"]);
  assert.deepEqual(s.schedule, { on: true, day: "light", night: "dark", dayStart: "07:00", nightStart: "21:30", sun: false });
  assert.equal(normalizeThemeSettings({ schedule: { sun: true } }).schedule.sun, true);
  // Material's grey and wavy shapes unless picked otherwise.
  assert.equal(normalizeThemeSettings({}).materialBlack, false);
  assert.equal(normalizeThemeSettings({ materialBlack: true }).materialBlack, true);
  assert.equal(normalizeThemeSettings({}).materialShape, "wavy");
  assert.equal(normalizeThemeSettings({ materialShape: "square" }).materialShape, "square");
  assert.equal(normalizeThemeSettings({ materialShape: "hexagon" }).materialShape, "wavy");
  assert.equal(normalizeThemeSettings({ schedule: { sun: "yes" } }).schedule.sun, false);
  assert.equal(findTheme("gone", s.custom).id, "dark");
});

test("coloured icons: off by default, the old Hardware switch carries over until the theme setting is saved", () => {
  assert.equal(normalizeThemeSettings({}).iconColors, false);
  assert.equal(normalizeThemeSettings({}, true).iconColors, true);
  assert.equal(normalizeThemeSettings({ iconColors: false }, true).iconColors, false);
  assert.equal(normalizeThemeSettings({ iconColors: "yes" }).iconColors, false);
});

test("cover tint: off by default, on only when saved as true", () => {
  assert.equal(normalizeThemeSettings({}).coverTint, false);
  assert.equal(normalizeThemeSettings({ coverTint: true }).coverTint, true);
  assert.equal(normalizeThemeSettings({ coverTint: "true" }).coverTint, false);
});

test("the Style: Crest by default and for anything unknown, Material only when saved", () => {
  assert.equal(normalizeThemeSettings({}).design, "crest");
  assert.equal(normalizeThemeSettings({ design: "material" }).design, "material");
  assert.equal(normalizeThemeSettings({ design: "fancy" }).design, "crest");
});

test("the font: the style's own by default, and an Inter saved before the Style setting becomes it, once", () => {
  assert.equal(normalizeThemeSettings({}).font, "auto");
  assert.equal(normalizeThemeSettings({ font: "georgia" }).font, "georgia");
  assert.equal(normalizeThemeSettings({ font: "Papyrus" }).font, "auto");
  assert.equal(normalizeThemeSettings({ font: "toString" }).font, "auto");
  // Before the Style setting Inter was the default nobody chose; saved beside a style, it was picked.
  const migrated = normalizeThemeSettings({ font: "inter" });
  assert.equal(migrated.font, "auto");
  assert.equal(normalizeThemeSettings({ font: "inter", design: "crest" }).font, "inter");
  assert.equal(normalizeThemeSettings({ ...migrated, font: "inter" }).font, "inter");
});

test("fontStack: auto is Inter in the Crest style and Google Sans Flex before Inter in Material, a chosen font stays", () => {
  assert.equal(fontStack("auto", "crest"), FONTS.inter);
  const material = fontStack("auto", "material");
  assert.ok(material.startsWith('"Google Sans Flex"'), material);
  assert.ok(material.includes(FONTS.inter), material);
  assert.equal(fontStack("georgia", "material"), FONTS.georgia);
});

test("captionSpacing: the caption's tracking measure.ts adds, text-caption's 0.01em of 11 px in the Crest style and none in Material", () => {
  assert.equal(captionSpacing("crest"), 0.11);
  assert.equal(captionSpacing("material"), 0);
  // What Material's rule in global.css sets, so the measured caption is the drawn one.
  assert.match(readFileSync(new URL("../../styles/global.css", import.meta.url), "utf8"), /\[data-design="material"\] \{[^}]*--text-caption--letter-spacing: 0;/);
});

test("over keeps the pop-up colours opaque", () => {
  for (const t of BUILT_IN_THEMES) assert.equal(parseColor(resolveTheme(t).vars["--color-elevated"])!.a, 1);
  assert.equal(over(parseColor("#00000000")!, parseColor("#123456")!).r, 0x12);
});

test("glass: off by default, on only when saved as true", () => {
  assert.equal(normalizeThemeSettings({}).glass, false);
  assert.equal(normalizeThemeSettings({ glass: true }).glass, true);
  assert.equal(normalizeThemeSettings({ glass: "true" }).glass, false);
});

test("the live glass's switch: off by default, on only when saved as true", () => {
  assert.equal(normalizeThemeSettings({}).glassLive, false);
  assert.equal(normalizeThemeSettings({ glassLive: true }).glassLive, true);
  assert.equal(normalizeThemeSettings({ glassLive: "true" }).glassLive, false);
});

test("status alerts as glass: on by default, off only when saved as false", () => {
  assert.equal(normalizeThemeSettings({}).glassAlerts, true);
  assert.equal(normalizeThemeSettings({ glassAlerts: false }).glassAlerts, false);
  assert.equal(normalizeThemeSettings({ glassAlerts: "false" }).glassAlerts, true);
});

test("the settings window's contour lines: on by default, off only when saved as false, and only Material themes carry a tertiary for them", () => {
  assert.equal(normalizeThemeSettings({}).contours, true);
  assert.equal(normalizeThemeSettings({ contours: false }).contours, false);
  assert.equal(normalizeThemeSettings({ contours: "no" }).contours, true);
  assert.equal(resolveTheme(BUILT_IN_THEMES[0]).m3Tertiary, undefined);
});

const veilOf = (t: ThemeFile) => parseColor(resolveTheme(t).vars["--glass-tint"])!;
const GLASS_STATUS = ["--glass-orange", "--glass-red", "--glass-green"];
const GREYS = Array.from({ length: 256 }, (_, g): Rgba => ({ r: g, g, b: g, a: 1 }));
/** The veil (`bg` at `alpha`) over a grey, with `top` laid on it. */
const veiled = (g: Rgba, alpha: number, bg: Rgba, top?: Rgba) => (top ? over(top, over(withAlpha(bg, alpha), g)) : over(withAlpha(bg, alpha), g));
/** The lowest contrast of `c` over the veil on any uniform grey. */
const worst = (c: Rgba, alpha: number, bg: Rgba, top?: Rgba) => Math.min(...GREYS.map((g) => contrast(c, veiled(g, alpha, bg, top))));
/** Every opacity in hundredths over every uniform grey. */
const brute = (bg: Rgba, texts: readonly (readonly [Rgba, number])[]) => {
  for (let i = 0; i <= 100; i++) if (GREYS.every((g) => texts.every(([c, min]) => contrast(c, veiled(g, i / 100, bg)) >= min))) return i / 100;
  return 1;
};

test("glass veil: the least share of the background that keeps every text level over any backdrop", () => {
  // Text over the veil: the theme's three levels and the status colours drawn under the glass.
  const levels = (r: ResolvedTheme): [Rgba, number][] => [
    [r.colors.foreground, STRONG_TEXT],
    [r.colors.secondary, TEXT],
    [r.colors.tertiary, TERTIARY],
    ...GLASS_STATUS.map((v): [Rgba, number] => [parseColor(r.vars[v])!, TEXT]),
  ];
  // docs/themes.md quotes Dark, Light and the opaque ones; a theme that changes colours changes its row.
  const table: Record<string, number> = {
    dark: 0.78, light: 0.8, "one-dark-pro": 0.86, "github-dark": 0.87, "github-light": 0.87, dracula: 0.83, "night-owl": 0.8, "catppuccin-mocha": 0.83,
    "catppuccin-latte": 1, nord: 0.93, "rose-pine": 0.93, "rose-pine-dawn": 1, "gruvbox-dark": 0.87, "solarized-light": 0.95, everforest: 0.96,
  };
  assert.deepEqual(Object.keys(table), BUILT_IN_THEMES.map((t) => t.id));
  for (const t of BUILT_IN_THEMES) {
    const r = resolveTheme(t);
    const veil = glassVeil(r.colors.background, levels(r));
    assert.equal(veil, brute(r.colors.background, levels(r)), t.id);
    assert.equal(veil, table[t.id], t.id);
    assert.equal(veilOf(t).a, veil, t.id);
  }
});

test("glass tokens", () => {
  assert.equal(resolveTheme(dark).vars["--glass-tint"], "rgb(0 0 0 / 0.78)");
  assert.equal(resolveTheme(dark).vars["--glass-tint-edge"], "rgb(0 0 0 / 0.35)");
  assert.equal(resolveTheme(light).vars["--glass-tint"], "rgb(250 250 252 / 0.8)");
  assert.equal(resolveTheme(findTheme("catppuccin-latte", [])).vars["--glass-tint"], "#e6e9ef");
  for (const t of BUILT_IN_THEMES) {
    const v = resolveTheme(t).vars;
    const edge = parseColor(v["--glass-tint-edge"])!.a;
    assert.ok(edge <= GLASS_EDGE && edge <= parseColor(v["--glass-tint"])!.a, t.id);
    assert.ok(parseColor(v["--glass-rim"]), t.id);
  }
});

test("glass status colours keep 4.5:1 over the veil on black and on white", () => {
  for (const t of BUILT_IN_THEMES) {
    const veil = veilOf(t);
    const v = resolveTheme(t).vars;
    for (const name of GLASS_STATUS) {
      const c = parseColor(v[name])!;
      for (const under of [BLACK, WHITE]) assert.ok(contrast(c, over(veil, under)) >= TEXT, `${t.id} ${name} over ${under === BLACK ? "black" : "white"}`);
    }
  }
  // Where the veil is opaque the panel's own colours are already right.
  const latte = resolveTheme(findTheme("catppuccin-latte", [])).vars;
  assert.deepEqual(GLASS_STATUS.map((n) => latte[n]), [latte["--color-orange"], latte["--color-red"], latte["--color-green"]]);
});

test("glass look: defaults, held to the sliders' ends and whole, anything else back to the default", () => {
  const look = (s: ReturnType<typeof normalizeThemeSettings>) => [s.glassTransparency, s.glassRefraction, s.glassFrost, s.glassRim];
  // Glass first switched on: 5% through with Dark, a softer bend, no frost, the full rim.
  assert.deepEqual(look(normalizeThemeSettings({})), [-75, 80, 0, 100]);
  assert.deepEqual(look(normalizeThemeSettings({ glassTransparency: 250, glassRefraction: -5, glassFrost: 33.4, glassRim: "150" })), [100, 0, 33, 100]);
  assert.equal(normalizeThemeSettings({ glassTransparency: -300 }).glassTransparency, -100);
  assert.equal(normalizeThemeSettings({ glassFrost: NaN }).glassFrost, 0);
});

test("frames per second: 10 by default, held to 10..30 and whole, anything else back to 10", () => {
  const fps = (glassFps: unknown) => normalizeThemeSettings({ glassFps }).glassFps;
  assert.equal(normalizeThemeSettings({}).glassFps, 10);
  assert.deepEqual([25, 45, 3, 19.6, "30", NaN].map(fps), [25, 30, 10, 20, 10, 10]);
});

test("Transparency: 0 is the safe veil, -100 opaque, 100 the clearest", () => {
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(glassVeilAt(0.78, 0, 0.59), 0.78);
  near(glassVeilAt(0.78, -100, 0.59), 1);
  near(glassVeilAt(0.78, 100, 0.59), 0.59);
  near(glassVeilAt(0.78, 40, 0.59), 0.704);
  near(glassVeilAt(0.78, -40, 0.59), 0.868);
  // The side bands: never clearer than their own.
  near(glassVeilAt(0.35, 100), 0.35);
  near(glassVeilAt(0.35, -100), 1);
  near(glassVeilAt(0.78, 250, 0.59), 0.59);
  near(glassVeilAt(0.78, -250, 0.59), 1);
  for (let t = -100; t < 100; t += 5) assert.ok(glassVeilAt(0.78, t + 5, 0.59) <= glassVeilAt(0.78, t, 0.59), String(t));
});

test("the clearest Transparency, and the tool bar's veil is the side bands'", () => {
  // docs/themes.md quotes Dark's and Light's.
  const table: Record<string, number> = {
    dark: 0.59, light: 0.56, "one-dark-pro": 0.74, "github-dark": 0.76, "github-light": 0.72, dracula: 0.69, "night-owl": 0.69, "catppuccin-mocha": 0.7,
    "catppuccin-latte": 0.81, nord: 0.72, "rose-pine": 0.8, "rose-pine-dawn": 0.81, "gruvbox-dark": 0.74, "solarized-light": 0.78, everforest: 0.82,
  };
  assert.deepEqual(Object.keys(table), BUILT_IN_THEMES.map((t) => t.id));
  for (const t of BUILT_IN_THEMES) {
    const r = resolveTheme(t), bg = r.colors.background, fg = r.colors.foreground;
    const clear = parseColor(r.vars["--glass-tint-clear"])!.a, bar = parseColor(r.vars["--glass-tint-edge"])!;
    assert.equal(clear, brute(bg, [[fg, TEXT], [r.colors.secondary, GRAPHIC]]), t.id);
    assert.equal(clear, table[t.id], t.id);
    assert.deepEqual(bar, withAlpha(bg, GLASS_EDGE), t.id);
    assert.ok(bar.a <= clear && clear <= veilOf(t).a, t.id);
    const at100 = glassVeilAt(veilOf(t).a, 100, clear);
    assert.ok(worst(r.colors.foreground, at100, bg) >= TEXT && worst(r.colors.secondary, at100, bg) >= GRAPHIC, t.id);
  }
});

test("more covered than the mark, every minimum holds", () => {
  for (const t of BUILT_IN_THEMES) {
    const r = resolveTheme(t), bg = r.colors.background;
    const texts: [Rgba, number][] = [
      [r.colors.foreground, STRONG_TEXT],
      [r.colors.secondary, TEXT],
      [r.colors.tertiary, TERTIARY],
      ...GLASS_STATUS.map((v): [Rgba, number] => [parseColor(r.vars[v])!, TEXT]),
    ];
    // Not the tool bar: Transparency leaves its veil as it is (GlassLayer.tsx), and its ink is tested below.
    for (const at of [-25, -50, -100]) {
      const veil = glassVeilAt(veilOf(t).a, at, parseColor(r.vars["--glass-tint-clear"])!.a);
      for (const [c, min] of texts) assert.ok(worst(c, veil, bg) >= min, `${t.id} ${at}`);
    }
  }
});

test("the tool bar's ink: white or black, the best worst case over its veil and the drop's fill", () => {
  // [ink, worst over the bare glass, worst under the drop]; docs/themes.md quotes them.
  const quoted: Record<string, [string, number, number]> = { dark: ["#ffffff", 2.43, 2.07], light: ["#000000", 2.95, 2.65] };
  const round = (x: number) => Math.round(x * 100) / 100;
  for (const t of BUILT_IN_THEMES) {
    const r = resolveTheme(t), bg = r.colors.background, fill3 = parseColor(r.vars["--color-fill-3"])!;
    const bar = parseColor(r.vars["--glass-tint-edge"])!.a;
    const inks = glassInk(r, true), ink = inks["--color-link"];
    assert.equal(Object.keys(inks).length, 20, t.id);
    assert.ok(Object.values(inks).every((v) => v === ink), t.id);
    assert.deepEqual(Object.keys(glassInk(r, false)), ["--color-label", "--color-label-2", "--color-link"], t.id);
    assert.equal(ink, r.dark ? "#ffffff" : "#000000", t.id);
    const bare = (c: Rgba) => worst(c, bar, bg), drop = (c: Rgba) => worst(c, bar, bg, fill3);
    const score = (c: Rgba) => Math.min(bare(c), drop(c));
    const best = score(parseColor(ink)!);
    // So clear a veil keeps no colour at 3:1, and neither the colours the bar had nor any grey reads better than the ink.
    assert.ok(best < GRAPHIC, t.id);
    const before = [r.colors.foreground, r.colors.secondary, ...["--color-link", ...Object.keys(HUE_PALETTE).map((h) => `--hue-${h}`)].map((v) => parseColor(r.vars[v])!)];
    for (const c of [...before, ...GREYS.filter((_, g) => g % 15 === 0)]) assert.ok(score(c) <= best, `${t.id} ${formatColor(c)}`);
    if (quoted[t.id]) assert.deepEqual([ink, round(bare(parseColor(ink)!)), round(drop(parseColor(ink)!))], quoted[t.id], t.id);
  }
});

test("the tool bar's ink over Liquid Glass +: the closed notch's label for the link and, with coloured icons, every hue", () => {
  const dark = resolveTheme(BUILT_IN_THEMES.find((t) => t.id === "dark")!).vars, label = dark["--color-label"];
  const hues = Object.keys(HUE_PALETTE).map((h) => `--hue-${h}`);
  const on = plusInk(dark, true), off = plusInk(dark, false);
  assert.equal(on["--accent"], dark["--theme-accent"]);
  assert.equal(on["--color-link"], label);
  assert.equal(on["--color-label-2"], dark["--color-label-2"]);
  assert.ok(hues.every((h) => on[h] === label));
  assert.ok(hues.every((h) => off[h] === dark[h]));
  assert.equal(off["--color-link"], label);
});

test("the yellow warning keeps 4.5:1 on the panel, on its group's fill and under the glass", () => {
  for (const t of BUILT_IN_THEMES) {
    const r = resolveTheme(t), bg = r.colors.background, fill1 = over(parseColor(r.vars["--color-fill-1"])!, bg);
    const caution = parseColor(r.vars["--color-caution"])!, glass = parseColor(r.vars["--glass-caution"])!, veil = veilOf(t);
    assert.ok(contrast(caution, bg) >= TEXT && contrast(caution, fill1) >= TEXT, t.id);
    const tops = [undefined, parseColor(r.vars["--color-fill-1"])!];
    for (const top of tops) assert.ok(worst(glass, veil.a, bg, top) >= TEXT, `${t.id} glass`);
  }
  // Dark's is the plain system yellow, as in tokens.css; light themes take a darker one, darker still under the glass.
  assert.equal(resolveTheme(dark).vars["--color-caution"], "#ffd60a");
  assert.deepEqual([resolveTheme(light).vars["--color-caution"], resolveTheme(light).vars["--glass-caution"]], ["#876b00", "#624d00"]);
});

test("the closed glass's ink keeps its minimum over the closed veil", () => {
  // Dark's ink with the darkest blue an album can give (accentFrom): lifted to 3:1, the status colours the glass's.
  assert.deepEqual(closedGlassInk(resolveTheme(dark), "#3333ff", false), {
    "--accent": "#6f6fff", "--color-link": "#419cff", "--color-yellow": "#ffd60a", "--color-orange": "#ff9f0a", "--color-red": "#ff766d", "--color-green": "#30d158",
  });
  // The readings' yellow of a light theme that colours the closed notch: 4.72:1 on the opaque notch, darkened to keep 3:1 over its veil.
  assert.equal(closedGlassInk(resolveTheme({ ...light, closedNotch: "background" }), "#3333ff", false)["--color-yellow"], "#886b00");
  const hued = closedGlassInk(resolveTheme(dark), "#3333ff", true);
  assert.equal(Object.keys(hued).length, 23);
  assert.equal(hued["--hue-indigo"], "#6f6fff");
  // Every built-in theme as the closed notch's ink, coloured icons on.
  for (const t of BUILT_IN_THEMES) {
    const r = resolveTheme({ ...t, closedNotch: "background" }), veil = parseColor(r.vars["--glass-tint"])!;
    const lowest = (c: string) => Math.min(...GREYS.map((g) => contrast(parseColor(c)!, over(veil, g))));
    for (const [name, value] of Object.entries(closedGlassInk(r, r.vars["--theme-accent"], true))) {
      const min = ["--color-orange", "--color-red", "--color-green"].includes(name) ? TEXT : GRAPHIC;
      assert.ok(lowest(value) >= min, `${t.id} ${name} ${value}`);
    }
  }
});

test("the System card: Dark or Light by the system's side, with the system's accent", () => {
  const sys = systemTheme({ accent: "#0078d4", dark: true })!;
  assert.equal(sys.id, "system");
  assert.deepEqual(sys.colors, { ...dark.colors, accent: "#0078d4" });
  assert.deepEqual(systemTheme({ accent: "#0078d4", dark: false })!.colors, { ...light.colors, accent: "#0078d4" });
  assert.equal(systemTheme(null), null);
  // Never read: a saved "system" is Dark, like any id that is gone.
  assert.equal(findTheme("system", [], null).id, "dark");
  assert.equal(findTheme("system", [], sys), sys);
  assert.equal(isBuiltIn("system"), true);
  const m = resolveMaterial(systemTheme({ accent: "#0078d4", dark: false })!);
  assert.equal(m.dark, false);
  assert.deepEqual(m.adjustments, []);
});

test("a file or a theme of one's own with the id \"system\" never takes the System card's place", () => {
  const file = { file: "s.json", text: JSON.stringify({ id: "system", name: "System", colors: { accent: "#ff0000" } }) };
  assert.notEqual(importThemes([], [file]).added[0].id, "system");
  // Saved before the card existed: the theme stays under a new id, and the choices that named it follow it.
  const s = normalizeThemeSettings({
    id: "system",
    custom: [{ id: "system", name: "System", colors: { accent: "#ff0000" } }],
    schedule: { on: true, day: "system", night: "dark" },
  });
  const renamed = uniqueId("system", takenIds([]));
  assert.notEqual(renamed, "system");
  assert.deepEqual(s.custom.map((t) => [t.id, t.colors.accent]), [[renamed, "#ff0000"]]);
  assert.deepEqual([s.id, s.schedule.day, s.schedule.night], [renamed, renamed, "dark"]);
  // The ids a new theme cannot take: every built-in, the System card's and the custom ones.
  const taken = takenIds([]);
  assert.ok(taken.has("system") && BUILT_IN_THEMES.every((t) => taken.has(t.id)));
  assert.equal(taken.size, BUILT_IN_THEMES.length + 1);
  assert.ok(takenIds([{ format: 1, id: "mine", name: "Mine", colors: {} }]).has("mine"));
  assert.notEqual(uniqueId("System", takenIds([])), "system");
});

test("the editor's colours: all five in Crest, in Material the starting colour first, then the background's side", () => {
  assert.deepEqual(editorKeys("crest"), EDITOR_KEYS);
  assert.deepEqual(editorKeys("material"), ["accent", "background"]);
});

test("the theme cards: the System card first when the system was read, then the built-ins, then one's own", () => {
  assert.deepEqual(themeChoices(null, []), BUILT_IN_THEMES);
  const sys = systemTheme({ accent: "#0078d4", dark: true })!;
  const mine: ThemeFile = { format: 1, id: "mine", name: "Mine", colors: {} };
  assert.deepEqual(themeChoices(sys, [mine]), [sys, ...BUILT_IN_THEMES, mine]);
});
