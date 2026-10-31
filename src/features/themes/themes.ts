// Translated from BrimDeck (Apache-2.0, github.com/MoFeng2223/BrimDeck), src/BrimDeck.Core/PanelThemes.cs, PanelThemes.Build.cs,
// PanelThemes.Derive.cs and Themes/*.json (the palettes of One Dark Pro, GitHub, Dracula and Night Owl, all MIT, see docs/themes.md).

import { BLACK, WHITE, contrast, ensureContrast, formatColor, isDark, mix, over, parseColor, toHex, withAlpha, type ContrastNeed, type Rgba } from "./color.ts";

/**
 * Panel themes. A theme names a few colours (THEME_KEYS); the rest of Crest's tokens follow from
 * them. Readability never depends on the theme: every colour with a minimum is held to it on the
 * backgrounds it is drawn on, and a colour that misses is moved along its own hue just far enough.
 */
export const THEME_KEYS = ["background", "foreground", "secondary", "tertiary", "accent", "warning", "critical", "success", "elevated"] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];
/** The colours the settings editor offers. */
export const EDITOR_KEYS = ["background", "foreground", "accent", "warning", "critical"] as const satisfies readonly ThemeKey[];

export interface ThemeFile {
  format: 1;
  id: string;
  name: string;
  description?: string;
  author?: string;
  license?: string;
  homepage?: string;
  colors: Partial<Record<ThemeKey, string>>;
  /** "black" (default): the closed notch stays black and keeps the dark text. "background": it takes the theme. */
  closedNotch?: "black" | "background";
}

export interface ThemeSettings {
  /** The chosen theme (the day theme's place is `schedule.day` while the schedule is on). */
  id: string;
  custom: ThemeFile[];
  /** Day and night: two themes switched by the local clock. */
  schedule: { on: boolean; day: string; night: string; dayStart: string; nightStart: string };
}

export const TEXT = 4.5, STRONG_TEXT = 7, GRAPHIC = 3;
export const MAX_FILE_BYTES = 64 * 1024;
export const DEFAULT_THEME = "dark";

/** Defaults of a dark and a light surface: what a file leaves out, and the alphas of the derived tokens. */
const MODES = {
  dark: {
    foreground: "rgb(255 255 255 / 0.96)",
    accent: "#419cff",
    warning: "#ff9f0a",
    critical: "#ff453a",
    success: "#30d158",
    yellow: "#ffd60a",
    alpha: { secondary: 0.58, tertiary: 0.36, label4: 0.18, fill1: 0.06, fill2: 0.1, fill3: 0.16, separator: 0.08 },
  },
  light: {
    foreground: "#1d1d1f",
    accent: "#0066cc",
    warning: "#9c6a00",
    critical: "#d1343b",
    success: "#248a3d",
    yellow: "#8a6d00",
    alpha: { secondary: 0.68, tertiary: 0.56, label4: 0.3, fill1: 0.04, fill2: 0.07, fill3: 0.12, separator: 0.1 },
  },
};

const builtIn = (id: string, name: string, colors: ThemeFile["colors"], extra: Partial<ThemeFile> = {}): ThemeFile => ({ format: 1, id, name, colors, ...extra });

/** Dark first (Crest's own look, equal to tokens.css), then Light, then the ported editor themes. */
export const BUILT_IN_THEMES: readonly ThemeFile[] = [
  builtIn("dark", "Dark", {
    background: "#000000",
    foreground: "rgb(255 255 255 / 0.96)",
    secondary: "rgb(255 255 255 / 0.58)",
    tertiary: "rgb(255 255 255 / 0.36)",
    accent: "#419cff",
    warning: "#ff9f0a",
    critical: "#ff453a",
    success: "#30d158",
    elevated: "#1c1c1e",
  }),
  builtIn("light", "Light", {
    background: "#fafafc",
    foreground: "#1d1d1f",
    accent: "#0066cc",
    warning: "#9c6a00",
    critical: "#d1343b",
    success: "#248a3d",
    elevated: "#ffffff",
  }),
  builtIn(
    "one-dark-pro",
    "One Dark Pro",
    { background: "#21252b", foreground: "#d7dae0", secondary: "#abb2bf", tertiary: "#8e939b", accent: "#61afef", warning: "#e5c07b", critical: "#e06c75", success: "#98c379", elevated: "#282c34" },
    { author: "Binaryify", license: "MIT", homepage: "https://github.com/Binaryify/OneDark-Pro" },
  ),
  builtIn(
    "github-dark",
    "GitHub Dark",
    { background: "#0d1117", foreground: "#e6edf3", secondary: "#9198a1", tertiary: "#7a838e", accent: "#4493f8", warning: "#d29922", critical: "#f85149", success: "#3fb950", elevated: "#161b22" },
    { author: "GitHub (Primer)", license: "MIT", homepage: "https://github.com/primer/github-vscode-theme" },
  ),
  builtIn(
    "github-light",
    "GitHub Light",
    { background: "#ffffff", foreground: "#1f2328", secondary: "#59636e", tertiary: "#6d7785", accent: "#0969da", warning: "#9a6700", critical: "#d1242f", success: "#1a7f37", elevated: "#ffffff" },
    { author: "GitHub (Primer)", license: "MIT", homepage: "https://github.com/primer/github-vscode-theme" },
  ),
  builtIn(
    "dracula",
    "Dracula",
    { background: "#21222c", foreground: "#f8f8f2", secondary: "#bdbfd0", tertiary: "#858fbb", accent: "#bd93f9", warning: "#f1fa8c", critical: "#ff5555", success: "#50fa7b", elevated: "#282a36" },
    { author: "Dracula Theme", license: "MIT", homepage: "https://github.com/dracula/visual-studio-code" },
  ),
  builtIn(
    "night-owl",
    "Night Owl",
    { background: "#011627", foreground: "#d6deeb", secondary: "#a1b3c8", tertiary: "#6e8da7", accent: "#82aaff", warning: "#ecc48d", critical: "#ef5350", success: "#addb67", elevated: "#0b253a" },
    { author: "Sarah Drasner", license: "MIT", homepage: "https://github.com/sdras/night-owl-vscode-theme" },
  ),
];

export const isBuiltIn = (id: string) => BUILT_IN_THEMES.some((t) => t.id === id);

/** The theme an id names, among the built-ins and the custom themes; a missing one (a deleted file) falls back to Dark. */
export function findTheme(id: string, custom: readonly ThemeFile[]): ThemeFile {
  return BUILT_IN_THEMES.find((t) => t.id === id) ?? custom.find((t) => t.id === id) ?? BUILT_IN_THEMES[0];
}

/** A colour that missed its minimum and was moved. `met` is false when no lightness could reach it. */
export interface Adjustment {
  key: ThemeKey | "yellow";
  from: string;
  to: string;
  ratio: number;
  minimum: number;
  met: boolean;
}

export interface ResolvedTheme {
  id: string;
  dark: boolean;
  /** CSS custom properties to set on the document. */
  vars: Record<string, string>;
  /** Final colours of the theme keys, as drawn. */
  colors: Record<ThemeKey, Rgba>;
  adjustments: Adjustment[];
  closedNotch: boolean;
}

/** From a theme file to Crest's tokens. */
export function resolveTheme(file: ThemeFile): ResolvedTheme {
  const written = (k: ThemeKey) => parseColor(file.colors[k]);
  const bg = over(written("background") ?? BLACK, BLACK);
  const dark = isDark(bg);
  const mode = dark ? MODES.dark : MODES.light;
  const ink = written("foreground") ?? parseColor(mode.foreground)!;
  const tint = (a: number) => withAlpha(ink, a);
  const elevated = over(written("elevated") ?? (dark ? mix(bg, over(ink, bg), 0.11) : mix(bg, WHITE, 0.8)), bg);
  const fill = [tint(mode.alpha.fill1), tint(mode.alpha.fill2), tint(mode.alpha.fill3)];
  const [fill1, fill2, fill3] = fill.map((f) => over(f, bg));

  const needs = (minimum: number, ...backgrounds: Rgba[]): ContrastNeed[] => backgrounds.map((background) => ({ background, minimum }));
  const adjustments: Adjustment[] = [];
  const ensure = (key: Adjustment["key"], c: Rgba, list: ContrastNeed[]): Rgba => {
    const after = ensureContrast(c, list);
    if (after === c) return c;
    const worst = list.reduce((a, b) => (contrast(c, a.background) / a.minimum <= contrast(c, b.background) / b.minimum ? a : b));
    const met = list.every((n) => contrast(after, n.background) >= n.minimum);
    adjustments.push({ key, from: formatColor(c), to: formatColor(after), ratio: contrast(c, worst.background), minimum: worst.minimum, met });
    return after;
  };
  const pick = (k: ThemeKey, fallback: string | Rgba) => written(k) ?? (typeof fallback === "string" ? parseColor(fallback)! : fallback);

  const colors: Record<ThemeKey, Rgba> = {
    background: bg,
    elevated,
    foreground: ensure("foreground", ink, [...needs(STRONG_TEXT, bg, elevated), ...needs(TEXT, fill3)]),
    secondary: ensure("secondary", pick("secondary", tint(mode.alpha.secondary)), needs(TEXT, bg, elevated, fill1, fill2)),
    tertiary: ensure("tertiary", pick("tertiary", tint(mode.alpha.tertiary)), needs(GRAPHIC, bg, elevated, fill1)),
    accent: ensure("accent", pick("accent", mode.accent), needs(GRAPHIC, bg, elevated)),
    warning: ensure("warning", pick("warning", mode.warning), needs(TEXT, bg)),
    critical: ensure("critical", pick("critical", mode.critical), needs(TEXT, bg)),
    success: ensure("success", pick("success", mode.success), needs(GRAPHIC, bg)),
  };
  const yellow = ensure("yellow", parseColor(mode.yellow)!, needs(GRAPHIC, bg));
  // Ink on label-coloured fills and on scrims (Tailwind's `black`): whichever of black and white reads better on the foreground.
  const label = over(colors.foreground, bg);
  const onLabel = contrast(WHITE, label) > contrast(BLACK, label) ? WHITE : BLACK;
  const closedNotch = file.closedNotch === "background";

  const vars: Record<string, string> = {
    "--color-notch": formatColor(bg),
    "--color-label": formatColor(colors.foreground),
    "--color-label-2": formatColor(colors.secondary),
    "--color-label-3": formatColor(colors.tertiary),
    "--color-label-4": formatColor(tint(mode.alpha.label4)),
    "--color-fill-1": formatColor(fill[0]),
    "--color-fill-2": formatColor(fill[1]),
    "--color-fill-3": formatColor(fill[2]),
    "--color-separator": formatColor(tint(mode.alpha.separator)),
    "--color-elevated": formatColor(elevated),
    "--color-green": formatColor(colors.success),
    "--color-red": formatColor(colors.critical),
    "--color-orange": formatColor(colors.warning),
    "--color-yellow": formatColor(yellow),
    "--color-link": formatColor(colors.accent),
    "--color-black": formatColor(onLabel),
    "--theme-accent": formatColor(colors.accent),
    "--notch-closed": closedNotch ? formatColor(bg) : "#000000",
  };
  return { id: file.id, dark, vars, colors, adjustments, closedNotch };
}

/** The cover colour as the open panel draws it: held to 3:1 on the background, unchanged where it already passes. */
export function readableAccent(raw: string, theme: ResolvedTheme): string {
  const c = parseColor(raw);
  if (!c) return raw;
  const after = ensureContrast(c, [{ background: theme.colors.background, minimum: GRAPHIC }]);
  return after === c ? raw : formatColor(after);
}

// ---------- Editing ----------

/** `#rrggbb`, or `#rrggbbaa` for a translucent colour. */
export function hexWithAlpha(c: Rgba): string {
  return c.a >= 1 ? toHex(c) : toHex(c) + Math.round(c.a * 255).toString(16).padStart(2, "0");
}

/**
 * The file after one of the editor's colours changes. A new background or foreground drops the
 * written secondary, tertiary and pop-up colours, so they follow from the new pair again; a
 * background that turns a dark theme light (or back) also brings a foreground that reads on it,
 * unless the written one already does. A translucent colour keeps its opacity.
 */
export function setThemeColor(file: ThemeFile, key: ThemeKey, value: Rgba): ThemeFile {
  const previous = parseColor(file.colors[key]);
  const next = key === "background" ? withAlpha(value, 1) : withAlpha(value, previous?.a ?? 1);
  const colors: ThemeFile["colors"] = { ...file.colors, [key]: hexWithAlpha(next) };
  if (key === "background" || key === "foreground") {
    delete colors.secondary;
    delete colors.tertiary;
    delete colors.elevated;
  }
  if (key === "background") {
    const before = over(parseColor(file.colors.background) ?? BLACK, BLACK);
    const nowDark = isDark(next);
    const fg = parseColor(file.colors.foreground);
    if (nowDark !== isDark(before) && (!fg || contrast(fg, next) < TEXT)) colors.foreground = nowDark ? MODES.dark.foreground : MODES.light.foreground;
  }
  return { ...file, colors };
}

// ---------- Ids, files and validation ----------

export function normalizeId(id: unknown): string {
  const text = String(id ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.]+|[-.]+$/g, "");
  return text.slice(0, 64).replace(/[-.]+$/, "");
}

/** `base`, or `base-2`, `base-3` … if that id is taken. */
export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  const id = normalizeId(base) || "theme";
  if (!taken.has(id)) return id;
  for (let n = 2; ; n++) if (!taken.has(`${id}-${n}`)) return `${id}-${n}`;
}

/** A problem with a file, as a German key for t() and its placeholders. */
export interface ThemeProblem {
  key: string;
  vars?: Record<string, string | number>;
}

export type ThemeCheck = { theme: ThemeFile; problems: [] } | { theme: null; problems: ThemeProblem[] };

const OPTIONAL_TEXT = ["description", "author", "license", "homepage"] as const;

/** Checks a parsed theme object and returns a clean copy (unknown top-level fields are dropped). */
export function validateTheme(input: unknown): ThemeCheck {
  const problems: ThemeProblem[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { theme: null, problems: [{ key: "Keine Theme-Datei: ein JSON-Objekt erwartet" }] };
  const o = input as Record<string, unknown>;
  if (o.format !== undefined && o.format !== 1) {
    problems.push(typeof o.format === "number" && o.format > 1 ? { key: "Format {n} ist neuer als diese Version von Crest", vars: { n: o.format } } : { key: "Unbekanntes Format" });
  }
  const name = typeof o.name === "string" ? o.name.trim().slice(0, 60) : "";
  const id = normalizeId(o.id ?? name);
  if (!id) problems.push({ key: "Name oder ID fehlt" });
  const colors: ThemeFile["colors"] = {};
  if (typeof o.colors !== "object" || o.colors === null || Array.isArray(o.colors)) problems.push({ key: "„colors“ fehlt oder ist kein Objekt" });
  else
    for (const [key, value] of Object.entries(o.colors)) {
      if (!(THEME_KEYS as readonly string[]).includes(key)) problems.push({ key: "Unbekannte Farbe „{key}“", vars: { key } });
      else if (!parseColor(value)) problems.push({ key: "„{key}“ ist keine Farbe: {value}", vars: { key, value: String(value).slice(0, 40) } });
      else colors[key as ThemeKey] = String(value).trim();
    }
  if (o.closedNotch !== undefined && o.closedNotch !== "black" && o.closedNotch !== "background") problems.push({ key: "„closedNotch“ muss „black“ oder „background“ sein" });
  if (problems.length) return { theme: null, problems };
  const theme: ThemeFile = { format: 1, id, name: name || id, colors };
  for (const k of OPTIONAL_TEXT) if (typeof o[k] === "string" && o[k]) theme[k] = (o[k] as string).slice(0, 200);
  if (o.closedNotch === "background") theme.closedNotch = "background";
  return { theme, problems: [] };
}

/** A theme file's text: size, JSON, then validateTheme. */
export function parseThemeText(text: string): ThemeCheck {
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) return { theme: null, problems: [{ key: "Datei größer als 64 KB" }] };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { theme: null, problems: [{ key: "Kein gültiges JSON: {error}", vars: { error: e instanceof Error ? e.message : String(e) } }] };
  }
  return validateTheme(value);
}

/** The file as Crest writes it on export. */
export function themeToText(theme: ThemeFile): string {
  const { format, id, name, description, author, license, homepage, colors, closedNotch } = theme;
  const ordered: Partial<Record<ThemeKey, string>> = {};
  for (const k of THEME_KEYS) if (colors[k]) ordered[k] = colors[k];
  return JSON.stringify({ format, id, name, description, author, license, homepage, colors: ordered, closedNotch }, null, 2) + "\n";
}

export interface ImportResult {
  added: ThemeFile[];
  replaced: ThemeFile[];
  failed: { file: string; problems: ThemeProblem[] }[];
}

/** Adds the valid files to the custom themes; one with a custom theme's id replaces it, one with a built-in id is refused. */
export function importThemes(custom: readonly ThemeFile[], files: { file: string; text?: string | null; error?: string | null }[]): ImportResult & { custom: ThemeFile[] } {
  const next = [...custom];
  const result: ImportResult = { added: [], replaced: [], failed: [] };
  for (const f of files) {
    const check: ThemeCheck = f.error || f.text == null ? { theme: null, problems: [{ key: f.error ?? "Datei nicht lesbar" }] } : parseThemeText(f.text);
    if (!check.theme) {
      result.failed.push({ file: f.file, problems: check.problems });
      continue;
    }
    const theme = check.theme;
    if (isBuiltIn(theme.id)) {
      result.failed.push({ file: f.file, problems: [{ key: "Die ID „{id}“ gehört zu einem eingebauten Theme", vars: { id: theme.id } }] });
      continue;
    }
    const at = next.findIndex((t) => t.id === theme.id);
    if (at >= 0) {
      next[at] = theme;
      result.replaced.push(theme);
    } else {
      next.push(theme);
      result.added.push(theme);
    }
  }
  return { ...result, custom: next };
}

// ---------- Settings ----------

export const THEME_DEFAULTS: ThemeSettings = {
  id: DEFAULT_THEME,
  custom: [],
  schedule: { on: false, day: "light", night: "dark", dayStart: "07:00", nightStart: "19:00" },
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Saved settings from any version: invalid custom themes and duplicate ids dropped, times checked. */
export function normalizeThemeSettings(raw: unknown): ThemeSettings {
  const s = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<ThemeSettings>;
  const custom: ThemeFile[] = [];
  for (const t of Array.isArray(s.custom) ? s.custom : []) {
    const check = validateTheme(t);
    if (check.theme && !isBuiltIn(check.theme.id) && !custom.some((c) => c.id === check.theme!.id)) custom.push(check.theme);
  }
  const d = THEME_DEFAULTS.schedule;
  const sc = (typeof s.schedule === "object" && s.schedule !== null ? s.schedule : {}) as Partial<ThemeSettings["schedule"]>;
  const text = (v: unknown, fallback: string) => (typeof v === "string" && v ? v : fallback);
  const time = (v: unknown, fallback: string) => (typeof v === "string" && TIME.test(v) ? v : fallback);
  return {
    id: text(s.id, THEME_DEFAULTS.id),
    custom,
    schedule: {
      on: sc.on === true,
      day: text(sc.day, d.day),
      night: text(sc.night, d.night),
      dayStart: time(sc.dayStart, d.dayStart),
      nightStart: time(sc.nightStart, d.nightStart),
    },
  };
}
