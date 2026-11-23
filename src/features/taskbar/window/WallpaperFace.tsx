// The face of the bar's Wallpaper widget, the wallpaper it follows and its menu's rows.

import type { PartId } from "../../../notch/row/parts";
import type { WallNow } from "../../../platform/services";
import type { Body, WidgetContext } from "./Widget";

/** The wallpaper the Wallpaper widget follows in the bar's own window; null for every other widget. */
export function useWall(_id: PartId): WallNow | null {
  return null;
}

/** The main screen's wallpaper as a small picture, with Previous and Next beside it in its other version; null without one. */
export function wallpaperPart(_ctx: WidgetContext): Body | null {
  return null;
}

/** Next wallpaper and Previous wallpaper over the widget's Crest menu rows. */
export function WallpaperRows(_props: { close: () => void; openTool: (tool: string) => void }) {
  return null;
}
