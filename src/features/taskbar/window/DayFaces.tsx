// The faces of the bar's Screen Time and Day timeline widgets, and what the timeline reads in the bar's own window.

import type { PartId } from "../../../notch/row/parts";
import type { Body, WidgetContext } from "./Widget";

/** What the Day timeline reads in the bar's own window: the focus rounds, the running one and the place's daylight, at `now`. */
export interface DayOwn {
  now: number;
}

/** The Day timeline's own reads, ticking each minute while the bar shows; undefined for every other widget. */
export function useDay(_id: PartId, _paused: boolean): DayOwn | undefined {
  return undefined;
}

/** Screen Time or the Day timeline as the bar draws it; null while it has nothing to show, and the bar draws its icon. */
export function dayPart(_id: "screentime" | "timeline", _ctx: WidgetContext): Body | null {
  return null;
}
