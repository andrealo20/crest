import { BLACK, contrast, ensureContrast, fromHsl, luminance, over, toHsl, type Rgba } from "../themes/color.ts";

/*
 * Colour maths for the Colour tool: reading what the user types, writing the formats back, OKLCH,
 * WCAG levels and the harmonies. WCAG contrast, luminance, HSL and the readability search come from
 * src/features/themes/color.ts. Channels are 0 to 255 integers, alpha 0 to 1, like there.
 * Nothing here returns NaN: input that is not a colour is null, a colour outside sRGB is pulled in.
 */

const CSS_NAMES: Record<string, string> = {
  aqua: "#00ffff", black: "#000000", blue: "#0000ff", brown: "#a52a2a", coral: "#ff7f50", crimson: "#dc143c", cyan: "#00ffff",
  fuchsia: "#ff00ff", gold: "#ffd700", gray: "#808080", grey: "#808080", green: "#008000", indigo: "#4b0082", ivory: "#fffff0",
  khaki: "#f0e68c", lavender: "#e6e6fa", lime: "#00ff00", magenta: "#ff00ff", maroon: "#800000", navy: "#000080", olive: "#808000",
  orange: "#ffa500", orchid: "#da70d6", pink: "#ffc0cb", plum: "#dda0dd", purple: "#800080", red: "#ff0000", salmon: "#fa8072",
  silver: "#c0c0c0", tan: "#d2b48c", teal: "#008080", tomato: "#ff6347", transparent: "#00000000", turquoise: "#40e0d0",
  violet: "#ee82ee", white: "#ffffff", yellow: "#ffff00",
};

// A NaN falls to `lo`, so a bad number can never travel on.
const clamp = (v: number, lo: number, hi: number) => (v > lo ? (v < hi ? v : hi) : lo);
const byte = (v: number) => Math.round(clamp(v, 0, 255));

const TOKEN = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|grad|rad|turn)?$/;

function token(s: string): [number, string] | null {
  const m = TOKEN.exec(s);
  const n = m ? Number(m[1]) : NaN;
  return m && Number.isFinite(n) ? [n, m[2] ?? ""] : null;
}

/** A channel of rgb(): 0 to 255, or a percentage. */
function channel(s: string): number | null {
  const t = token(s);
  return !t || (t[1] && t[1] !== "%") ? null : t[1] ? (t[0] * 255) / 100 : t[0];
}

/** A number that is `unit` at 100 %, or a percentage of `full`: alpha 1/1, saturation 100/1, OKLCH chroma 1/0.4. */
function amount(s: string, unit: number, full: number): number | null {
  const t = token(s);
  if (!t || (t[1] && t[1] !== "%")) return null;
  return t[1] ? (t[0] / 100) * full : t[0] / unit;
}

/** A hue in degrees, from deg, turn, rad, grad or a bare number. */
function hue(s: string): number | null {
  const t = token(s);
  if (!t) return null;
  const [n, unit] = t;
  const deg = unit === "" || unit === "deg" ? n : unit === "turn" ? n * 360 : unit === "rad" ? (n * 180) / Math.PI : unit === "grad" ? n * 0.9 : null;
  return deg === null ? null : ((deg % 360) + 360) % 360;
}

/**
 * What a person types or pastes: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` (the # is optional), rgb()/rgba(),
 * hsl()/hsla(), oklch() (commas or spaces, `/` before the alpha, percentages) and the common CSS names.
 * Anything else is null.
 */
export function parseColour(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  if (!s || s.length > 80) return null;
  const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(Object.hasOwn(CSS_NAMES, s) ? CSS_NAMES[s] : s);
  if (hex) {
    const h = hex[1].length <= 4 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^(rgba?|hsla?|oklch)\(([^()]*)\)$/.exec(s);
  if (!fn) return null;
  const parts = fn[2].trim().split(/\s*[,/]\s*|\s+/);
  if (parts.length < 3 || parts.length > 4) return null;
  const a = parts.length === 4 ? amount(parts[3], 1, 1) : 1;
  if (a === null) return null;
  const alpha = clamp(a, 0, 1);
  if (fn[1].startsWith("rgb")) {
    const [r, g, b] = parts.slice(0, 3).map(channel);
    return r === null || g === null || b === null ? null : { r: byte(r), g: byte(g), b: byte(b), a: alpha };
  }
  if (fn[1].startsWith("hsl")) {
    const h = hue(parts[0]), sat = amount(parts[1], 100, 1), l = amount(parts[2], 100, 1);
    return h === null || sat === null || l === null ? null : { ...fromHsl(h, sat, l), a: alpha };
  }
  const l = amount(parts[0], 1, 1), c = amount(parts[1], 1, 0.4), h = hue(parts[2]);
  return l === null || c === null || h === null ? null : fromOklch({ l, c, h }, alpha);
}

// sRGB 0 to 255 <-> linear light 0 to 1.
const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const c = clamp(v, 0, 1);
  return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
};

/** OKLCH: lightness 0 to 1, chroma (about 0 to 0.4 in sRGB), hue in degrees. Hue is 0 for greys. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

// Matrices from Björn Ottosson's OKLab (public domain).
export function toOklch(col: Rgba): Oklch {
  const r = toLinear(col.r), g = toLinear(col.g), b = toLinear(col.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lab = { l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s };
  const c = Math.hypot(lab.a, lab.b);
  return { l: lab.l, c, h: c < 1e-4 ? 0 : ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360 };
}

function linearRgb(l: number, c: number, h: number): number[] {
  const a = c * Math.cos((h * Math.PI) / 180), b = c * Math.sin((h * Math.PI) / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S, -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S, -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S];
}

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -1e-6 && v <= 1 + 1e-6);

/** OKLCH to sRGB. Outside sRGB it keeps lightness and hue and takes the most chroma that fits. */
export function fromOklch(x: Oklch, alpha = 1): Rgba {
  const l = clamp(x.l, 0, 1);
  const h = Number.isFinite(x.h) ? x.h : 0;
  const c = Number.isFinite(x.c) ? Math.max(0, x.c) : 0;
  let rgb = linearRgb(l, c, h);
  if (!inGamut(rgb)) {
    let lo = 0, hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(linearRgb(l, mid, h))) lo = mid;
      else hi = mid;
    }
    rgb = linearRgb(l, lo, h);
  }
  return { r: byte(fromLinear(rgb[0])), g: byte(fromLinear(rgb[1])), b: byte(fromLinear(rgb[2])), a: clamp(alpha, 0, 1) };
}

const hex2 = (v: number) => byte(v).toString(16).padStart(2, "0");
const alpha8 = (c: Rgba) => Math.round(clamp(c.a, 0, 1) * 255);
/** 3 decimals at most, no trailing zeros. */
const short = (v: number, digits: number) => String(+v.toFixed(digits));

/** `#rrggbb`, with two more digits when the colour is translucent. */
export const formatHex = (c: Rgba) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${alpha8(c) < 255 ? hex2(alpha8(c)) : ""}`;

export const formatRgb = (c: Rgba) => (alpha8(c) < 255 ? `rgba(${byte(c.r)}, ${byte(c.g)}, ${byte(c.b)}, ${short(c.a, 2)})` : `rgb(${byte(c.r)}, ${byte(c.g)}, ${byte(c.b)})`);

export function formatHsl(c: Rgba): string {
  const [h, s, l] = toHsl(c);
  const body = `${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`;
  return alpha8(c) < 255 ? `hsla(${body}, ${short(c.a, 2)})` : `hsl(${body})`;
}

export function formatOklch(c: Rgba): string {
  const { l, c: chroma, h } = toOklch(c);
  return `oklch(${short(clamp(l, 0, 1), 3)} ${short(chroma, 3)} ${short(h, 1)}${alpha8(c) < 255 ? ` / ${short(c.a, 2)}` : ""})`;
}

/** A custom property, ready to paste into a stylesheet. */
export const formatVar = (c: Rgba) => `--colour: ${formatHex(c)};`;

/** The WCAG 2 thresholds: AA for large text, AA, AAA. */
export const WCAG = { aaLarge: 3, aa: 4.5, aaa: 7 } as const;

export const levels = (ratio: number) => ({ aaLarge: ratio >= WCAG.aaLarge, aa: ratio >= WCAG.aa, aaa: ratio >= WCAG.aaa });

/** The ratio to show, two decimals. One that only rounds up to a level does not show it: 4.496 reads 4.49, not a 4.50 that fails. */
export function ratioShown(ratio: number): number {
  const rounded = Math.round(ratio * 100) / 100;
  return Object.values(WCAG).some((level) => rounded >= level && ratio < level) ? Math.floor(ratio * 100) / 100 : rounded;
}

export interface Readable {
  colour: Rgba;
  ratio: number;
  lighter: boolean;
}

/**
 * The nearest colour of the same hue and saturation that reaches `target` on `background`, lighter or darker
 * whichever is the smaller step. Null when `fg` already reaches it.
 */
export function readableVersion(fg: Rgba, background: Rgba, target: number = WCAG.aa): Readable | null {
  if (contrast(fg, background) >= target) return null;
  const colour = ensureContrast(fg, [{ background, minimum: target }]);
  const ratio = contrast(colour, background);
  if (ratio < target) return null;
  return { colour, ratio, lighter: luminance(colour) > luminance(over(fg, over(background, BLACK))) };
}

export type HarmonyId = "complementary" | "triad" | "analogous";

/** Turns of the HSL hue; `c` itself stays as given. Greys have no hue, so their harmonies are the grey. */
export function harmonies(c: Rgba): { id: HarmonyId; colours: Rgba[] }[] {
  const [h, s, l] = toHsl(c);
  const turn = (deg: number): Rgba => ({ ...fromHsl(h + deg, s, l), a: c.a });
  return [
    { id: "complementary", colours: [c, turn(180)] },
    { id: "triad", colours: [c, turn(120), turn(240)] },
    { id: "analogous", colours: [turn(-30), c, turn(30)] },
  ];
}

export const HISTORY_MAX = 12;

/** `hex` first, once, and at most 12 in all. */
export const remember = (history: string[], hex: string) => [hex, ...history.filter((h) => h !== hex)].slice(0, HISTORY_MAX);

export interface ColourState {
  /** The colour on show, as `#rrggbb[aa]`. */
  current: string | null;
  /** The second colour of the contrast check. */
  other: string | null;
  /** The last colours chosen, newest first. */
  history: string[];
}

const canonical = (v: unknown): string | null => {
  const c = typeof v === "string" ? parseColour(v) : null;
  return c ? formatHex(c) : null;
};

/** What was saved, made safe: unreadable colours dropped, duplicates merged, at most 12. */
export function normaliseColourState(raw: unknown): ColourState {
  const s = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Record<keyof ColourState, unknown>>;
  const history: string[] = [];
  for (const item of Array.isArray(s.history) ? s.history : []) {
    const hex = canonical(item);
    if (hex && !history.includes(hex)) history.push(hex);
  }
  return { current: canonical(s.current), other: canonical(s.other), history: history.slice(0, HISTORY_MAX) };
}
