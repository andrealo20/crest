// The faces of the bar's Exchange rate and Crypto widgets.

import type { Body, WidgetContext } from "./Widget";

/** The exchange rate or the coin as the bar draws it; null before the first read, and the bar draws its icon. */
export function marketPart(_id: "currency" | "crypto", _ctx: WidgetContext): Body | null {
  return null;
}
