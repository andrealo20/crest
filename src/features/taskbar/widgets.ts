// The closed notch's parts as widgets of Crest's bar: which items are widgets, what a click on one opens, their size, and adding
// or removing one. Pure, so the rules are tested without the app around them.

import { PART_IDS, partTool, type PartId } from "../../notch/row/parts.ts";
import { TASKBAR_DEFAULTS, fitIcon, type BarItem, type Zone } from "./model.ts";

/** What the settings take off the bar and put back like a widget: the widgets, the tray and Stato. */
export type Removable = PartId | "tray" | "status";

export const isWidget = (id: string): id is PartId => PART_IDS.includes(id as PartId);

/** The tool a widget opens in the panel over the bar; null for the clock, which opens Windows' calendar instead. */
export const widgetTool = (id: PartId): string | null => (id === "clock" ? null : partTool(id));

/** A widget's size against the notch's: 1 with the default icons, growing and shrinking with the icons the bar draws. */
export const widgetScale = (height: number, iconSize: number): number => fitIcon(height, iconSize) / TASKBAR_DEFAULTS.iconSize;

/** The widgets on the bar, reading left, center, right. */
export const barWidgets = (zones: Record<Zone, BarItem[]>): PartId[] => [...zones.left, ...zones.center, ...zones.right].filter(isWidget);

/**
 * The widgets the notch's stores run for the bar (barParts): all of them while the bar is on and its sources run (feed.tsx: it shows,
 * or it slid away less than SLIDE_KEEP_MS ago), none while it is off, and otherwise only Discord, which stays connected: each connect
 * is a login with a token refresh, and a failed one asks for consent again.
 */
export const barPartsFor = (widgets: PartId[], on: boolean, shown: boolean): PartId[] =>
  !on ? [] : shown ? widgets : widgets.filter((id) => id === "discord");

/**
 * The sources the notch runs for the bar (feed.tsx): those of `parts`, and the equalizer's, which keeps the audio capture on, while
 * a bar's panel shows Now Playing (`media`), whose equalizer only listens to the levels.
 */
export const barSources = (parts: readonly PartId[], media: boolean): readonly PartId[] => (media && !parts.includes("equalizer") ? [...parts, "equalizer"] : parts);

/** How long the notch keeps the bar's widget sources after the primary bar starts sliding away (auto-hide), ms: back within it, the bar finds them running. */
export const SLIDE_KEEP_MS = 30_000;

/** What the notch hears of the primary bar (`bar://shown`, bar.rs `notch_hears`): its window shows (a full-screen app and the hide hotkey hide it), and its page slid it off the screen. */
export interface BarSeen {
  shown: boolean;
  slid: boolean;
}

/**
 * The widgets' sources once the primary bar goes from `before` to `now`: running while it shows and is up; kept for SLIDE_KEEP_MS when
 * it starts sliding away from up ("keep"), then resting; resting at once when its window hides, and while it shows again still slid.
 * Null when nothing changed, so a repeated message neither stops them nor starts another wait.
 */
export function sourcesAfter(before: BarSeen, now: BarSeen): "run" | "keep" | "rest" | null {
  if (now.shown === before.shown && now.slid === before.slid) return null;
  if (!now.shown) return "rest";
  if (!now.slid) return "run";
  return before.shown && !before.slid ? "keep" : "rest";
}

/**
 * The zones with `id` last in `to`, before the Crest button when the zone ends with it, so the button stays at the edge; a
 * widget (or the tray, or Stato) already on the bar leaves them as they are.
 */
export function addWidget(zones: Record<Zone, BarItem[]>, id: Removable, to: Zone): Record<Zone, BarItem[]> {
  if (Object.values(zones).some((items) => items.includes(id))) return zones;
  const items = zones[to], at = items.at(-1) === "crest" ? items.length - 1 : items.length;
  return { ...zones, [to]: [...items.slice(0, at), id, ...items.slice(at)] };
}

/** The zones without `id`. */
export const removeWidget = (zones: Record<Zone, BarItem[]>, id: Removable): Record<Zone, BarItem[]> => ({
  left: zones.left.filter((x) => x !== id),
  center: zones.center.filter((x) => x !== id),
  right: zones.right.filter((x) => x !== id),
});
