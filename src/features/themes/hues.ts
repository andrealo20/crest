import { settings } from "../../settings/store";

/**
 * Icon colours for "Coloured icons" (Settings, Themes): the tool bar, the settings pages and the weather.
 * Each hue is a CSS variable in themes.css, a shade darker on light themes so it still reads there.
 */
export type Hue = "red" | "orange" | "amber" | "yellow" | "lime" | "green" | "emerald" | "teal" | "cyan" | "sky" | "blue" | "indigo" | "violet" | "purple" | "pink" | "rose" | "slate";

export const hueVar = (hue: Hue) => `var(--hue-${hue})`;

export const useIconColors = () => settings.use().themes.iconColors;

/** The icon's colour while coloured icons are on, else undefined (the icon keeps its text colour). */
export function useHue(hue: Hue | undefined): string | undefined {
  const on = useIconColors();
  return on && hue ? hueVar(hue) : undefined;
}
