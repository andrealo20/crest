// The faces of the bar's Top apps and Battery widgets, and the Hardware widget's network line.

import type { Body, WidgetContext } from "./Widget";

/** Top apps or the battery as the bar draws it; null while it has nothing to show, and the bar draws its icon. */
export function systemPart(_id: "processes" | "battery", _ctx: WidgetContext): Body | null {
  return null;
}

/** The Hardware widget's line of the network's download and upload; null draws its dials. */
export function netPart(_ctx: WidgetContext): Body | null {
  return null;
}
