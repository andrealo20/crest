import {
  Blend,
  Hct,
  MaterialDynamicColors as M,
  SchemeMonochrome,
  SchemeTonalSpot,
  TonalPalette,
  argbFromHex,
  argbFromRgb,
  hexFromArgb,
  type DynamicColor,
} from "@material/material-color-utilities";
import { BLACK, formatColor, isDark, over, parseColor, withAlpha } from "./color.ts";
import { MODES, resolveTheme, type ResolvedTheme, type ThemeFile } from "./themes.ts";

/** M3 draws disabled content as on-surface at 38 %, the role of Crest's faintest text level. */
const DISABLED = 0.38;

/** A colour on its own hue and chroma at the tone M3 gives a custom colour: 80 on dark, 40 on light. */
function toned(argb: number, dark: boolean): string {
  const h = Hct.fromInt(argb);
  return hexFromArgb(TonalPalette.fromHueAndChroma(h.hue, h.chroma).tone(dark ? 80 : 40));
}

/**
 * A theme in the Material style: its accent seeds an M3 scheme (spec 2021) on the theme's side, and resolveTheme derives the
 * rest from the scheme's roles, so the glass, the hues and the readability checks come from the same code as in Crest.
 * `contrast` 1 is the system's "more contrast".
 */
export function resolveMaterial(file: ThemeFile, { contrast = 0 }: { contrast?: 0 | 1 } = {}): ResolvedTheme {
  const dark = isDark(over(parseColor(file.colors.background) ?? BLACK, BLACK));
  const accent = parseColor(file.colors.accent) ?? parseColor(MODES[dark ? "dark" : "light"].accent)!;
  const seed = argbFromRgb(accent.r, accent.g, accent.b);
  const source = Hct.fromInt(seed);
  // Tonal Spot sets its own chroma, so a grey or white accent would come back as a tint the theme never had.
  const scheme = new (source.chroma < 8 ? SchemeMonochrome : SchemeTonalSpot)(source, dark, contrast);
  const role = (c: DynamicColor) => hexFromArgb(c.getArgb(scheme));
  const colors: ThemeFile["colors"] = {
    background: role(M.surface),
    foreground: role(M.onSurface),
    secondary: role(M.onSurfaceVariant),
    tertiary: role(M.outline),
    accent: role(M.primary),
    link: role(M.primary),
    critical: role(M.error),
    // Orange and yellow keep their own hue: harmonised, a blue seed turns the yellow lime and One Dark Pro's the orange amber.
    warning: toned(argbFromHex(MODES.dark.warning), dark),
    success: toned(Blend.harmonize(argbFromHex(MODES.dark.success), seed), dark),
    // One step off the group a menu opens over, as in Crest: lighter on dark, white on light.
    elevated: role(dark ? M.surfaceContainerHigh : M.surfaceContainerLowest),
  };
  const r = resolveTheme({ ...file, colors }, { yellow: toned(argbFromHex(MODES.dark.yellow), dark) });
  return {
    ...r,
    vars: {
      ...r.vars,
      "--color-label-4": formatColor(withAlpha(r.colors.foreground, DISABLED)),
      "--color-separator": role(M.outlineVariant),
      "--color-primary": role(M.primary),
      "--color-on-primary": role(M.onPrimary),
      "--color-secondary-container": role(M.secondaryContainer),
      "--color-on-secondary-container": role(M.onSecondaryContainer),
    },
  };
}

/** The closed notch stays black in the Material style, so its ink is the dark scheme of the same seed. */
export function materialInk(file: ThemeFile, opts?: { contrast?: 0 | 1 }): ResolvedTheme {
  return resolveMaterial({ ...file, colors: { ...file.colors, background: "#000000" } }, opts);
}
