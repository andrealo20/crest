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
