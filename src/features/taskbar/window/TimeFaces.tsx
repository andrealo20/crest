// The clock's versions past the digital one, Analog and Two time zones, and the bar's Time progress, Date and World time widgets.

import type { WidgetVariants } from "../model";
import type { Body, WidgetContext } from "./Widget";

/** The clock in one of its other versions; null draws the digital clock. */
export function clockPart(_variant: Exclude<WidgetVariants["clock"], "digital" | "analog" | "zones">, _ctx: WidgetContext): Body | null {
  return null;
}

/** The time progress, the date or the world time; null while it has nothing to show (the world time without a zone in Clocks), and the bar draws its icon. */
export function timePart(_id: "progress" | "date" | "world", _ctx: WidgetContext): Body | null {
  return null;
}
