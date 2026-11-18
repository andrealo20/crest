// The closed notch's parts as widgets of Crest's bar: which items are widgets, what a click on one opens, their size, and adding
// or removing one. Pure, so the rules are tested without the app around them.

import { PART_IDS, partTool, type PartId } from "../../notch/row/parts.ts";
import { TASKBAR_DEFAULTS, fitIcon, type BarItem, type Zone } from "./model.ts";

export const isWidget = (id: string): id is PartId => PART_IDS.includes(id as PartId);

/** The tool a widget opens in the panel over the bar; null for the clock, which opens Windows' calendar instead. */
export const widgetTool = (id: PartId): string | null => (id === "clock" ? null : partTool(id));

/** A widget's size against the notch's: 1 with the default icons, growing and shrinking with the icons the bar draws. */
export const widgetScale = (height: number, iconSize: number): number => fitIcon(height, iconSize) / TASKBAR_DEFAULTS.iconSize;

/** The widgets on the bar, reading left, center, right. */
export const barWidgets = (zones: Record<Zone, BarItem[]>): PartId[] => [...zones.left, ...zones.center, ...zones.right].filter(isWidget);

/**
 * The widgets the notch's stores run for the bar (barParts): all of them while the bar is on and shows, none while it is off, and
 * while it hides only Discord, which stays connected: each connect is a login with a token refresh, and a failed one asks for
 * consent again.
 */
export const barPartsFor = (widgets: PartId[], on: boolean, shown: boolean): PartId[] =>
  !on ? [] : shown ? widgets : widgets.filter((id) => id === "discord");

/**
 * The zones with `id` last in `to`, before the Crest button when the zone ends with it, so the button stays at the edge; a
 * widget already on the bar leaves them as they are.
 */
export function addWidget(zones: Record<Zone, BarItem[]>, id: PartId, to: Zone): Record<Zone, BarItem[]> {
  if (barWidgets(zones).includes(id)) return zones;
  const items = zones[to], at = items.at(-1) === "crest" ? items.length - 1 : items.length;
  return { ...zones, [to]: [...items.slice(0, at), id, ...items.slice(at)] };
}

/** The zones without `id`. */
export const removeWidget = (zones: Record<Zone, BarItem[]>, id: PartId): Record<Zone, BarItem[]> => ({
  left: zones.left.filter((x) => x !== id),
  center: zones.center.filter((x) => x !== id),
  right: zones.right.filter((x) => x !== id),
});
