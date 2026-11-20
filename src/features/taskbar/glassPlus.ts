// The rules and numbers of the taskbar's Liquid Glass + (window/glassPlusShader.ts), after LiquidGlassWindows' glass (MIT, pxlkeshi,
// src/glass.rs at 4e2c03f). Pure, so node --test runs them.

import { GLASS } from "../../notch/glass/params.ts";
import { WHITE, luminance, over } from "../themes/color.ts";
import type { ThemeSettings } from "../themes/themes.ts";

export const GLASS_PLUS = {
  /** The lens's band, of the shape's shorter side. */
  band: 0.3,
  /** The lens pulls at most this many of the other axis's half sides. */
  reach: 4,
  /** The Refraction (%) at which the lens is the widgets'. */
  refraction: 80,
  /** Red and blue either side of green, CSS px (0.0019 of a screen 900 CSS px tall, 1800 px at 200%). */
  chroma: 0.0019 * 900,
  /** The blur level over log2 of the scale: about the widgets' 1 CSS px (two 2 px box passes at 1800). */
  blur: 0.5,
  /** The widgets' 0.9 darkening, in linear light. */
  darken: 0.9 ** 2.2,
  /** The widgets' saturation. */
  saturation: 1.2,
  /** Where the rim light comes from, degrees, y down. */
  light: -135,
  /** The rim light's opposite side. */
  reflected: 0.8,
  /** How tight it gathers at the two lit corners. */
  focus: 3,
  /** Its least, all round. */
  hairline: 0.22,
  /** Its glow across the band. */
  glow: 0.14,
  /** Its strength at Rim light 100. */
  specular: 0.62,
  /** Its line's width, device px (1.116, the widgets' on a screen 1800 px tall). */
  rim: 0.00062 * 1800,
  /** The coarse brightness (linear) from which a backdrop counts as white, and where it fully does. */
  knee: [0.35, 0.6],
  /** The coarse read's level over log2 of the scale: texels of 32 CSS px. */
  veilLevel: 5,
} as const;

/**
 * The glass's sliders (Settings › Themes › Glass) as Liquid Glass + reads them at `dpr`; at the defaults (80, 0, 100) the widgets'
 * glass. Frost's blur adds to the widgets' in quadrature, so Frost 0 leaves theirs alone.
 */
export function plusSliders(t: Pick<ThemeSettings, "glassRefraction" | "glassFrost" | "glassRim">, dpr: number): { strength: number; lod: [number, number]; spec: number } {
  const s = Math.log2(dpr), rim = Math.max(0, s + GLASS_PLUS.blur);
  return {
    strength: t.glassRefraction / GLASS_PLUS.refraction,
    lod: [rim, 0.5 * Math.log2(4 ** rim + (t.glassFrost / 100) ** 2 * 4 ** (s + GLASS.lodMid))],
    spec: (GLASS_PLUS.specular * t.glassRim) / 100,
  };
}

/**
 * The luminance (WCAG, linear) Liquid Glass + shows at most where its backdrop is white: Glass's there, the veil `veil` of the tint
 * (sRGB 0 to 1, as parseTint gives it; its alpha is not read) over white, mixed in sRGB as the bar's CSS veil and BAR_FS mix it.
 */
export function plusTarget(tint: readonly number[], veil: number): number {
  return luminance(over({ r: tint[0] * 255, g: tint[1] * 255, b: tint[2] * 255, a: veil }, WHITE));
}

/** The shader's line over the edge's own device px (its centre, half a px in): what a one px ring in CSS shows of it. */
const T = 0.5 / GLASS_PLUS.rim, EDGE_LINE = 0.85 * Math.exp(-T * T) + 0.15 * Math.exp(-T);

/**
 * Liquid Glass +'s rim light on a panel above the bar (BarPanel.tsx), in CSS: no live copy shows there, so no shader. White, `px` CSS
 * px wide (one device px), at Rim light `rim` (%), null at 0: GLASS_PLUS.hairline of it all round, and the rest from GLASS_PLUS.light
 * as a shadow pushed `px` that way, which lights the two sides that meet at the lit corner, one device px wide all along them, and
 * tapers to nothing only through the arcs of the next two corners; the opposite corner `reflected` of it. Inset shadows only: a
 * padding or a border under 1 CSS px is drawn a whole CSS px wide, and a mask would turn the panel's text to greyscale antialiasing.
 */
export function plusPanelRim(rim: number, px: number): { boxShadow: string } | null {
  const k = Math.min((GLASS_PLUS.specular * rim * EDGE_LINE) / 100, 1);
  if (k <= 0) return null;
  const a = (GLASS_PLUS.light * Math.PI) / 180, x = +(-Math.cos(a) * px).toFixed(3), y = +(-Math.sin(a) * px).toFixed(3);
  const white = (alpha: number) => `rgb(255 255 255 / ${alpha.toFixed(3)})`, lit = k * (1 - GLASS_PLUS.hairline);
  return {
    boxShadow: [
      `inset 0 0 0 ${px}px ${white(k * GLASS_PLUS.hairline)}`,
      `inset ${x}px ${y}px 0 0 ${white(lit)}`,
      `inset ${-x}px ${-y}px 0 0 ${white(lit * GLASS_PLUS.reflected)}`,
    ].join(", "),
  };
}
