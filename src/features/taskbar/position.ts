/**
 * The bar's edge in the page's geometry: every rule that once said "bottom" asks here, so no component writes the edge itself. Pure,
 * boxes in the bar window's CSS px. A popup's `off` is the room from the window's edge on the bar's side to the popup's edge towards
 * the bar: the bar, its gaps and the gap before the popup.
 */
import type { BarEdge } from "./model.ts";

type Box = { x: number; y: number; w: number; h: number };
/** A box's top and bottom, as a DOMRect has them. */
type Span = { top: number; bottom: number };

/** The CSS offset of a popup `off` px from the window's edge on the bar's side. */
export const popupAt = (edge: BarEdge, off: number) => (edge === "top" ? { top: off } : { bottom: off });

/** The y of that popup, `h` tall, for the hit zone. */
export const popupY = (edge: BarEdge, off: number, h: number, height: number) => (edge === "top" ? off : height - off - h);

/** Where a popup grows from: the middle of its side towards the bar. */
export const growFrom = (edge: BarEdge) => (edge === "top" ? "50% 0%" : "50% 100%");

/** The px a popup starts moved back towards the bar along y; a lifted icon moves the other way. */
export const nudge = (edge: BarEdge) => (edge === "top" ? -2 : 2);

/** How far along y the bar slides off its screen edge: down for a bottom bar, up for a top one. */
export const slideBy = (edge: BarEdge, distance: number) => (edge === "top" ? -distance : distance);

/** The `strip` px along the window's edge on the screen's edge (autoHide.ts zones). */
export const edgeStrip = (edge: BarEdge, strip: number, width: number, height: number): Box => ({ x: 0, y: edge === "top" ? 0 : height - strip, w: width, h: strip });

/** A box stretched to the window's edge on the screen's side, so the gap between the bar and the screen's edge takes the click. */
export const toEdge = (edge: BarEdge, b: Box, height: number): Box => (edge === "top" ? { ...b, y: 0, h: b.y + b.h } : { ...b, h: height - b.y });

/** From the window's edge on the bar's side to the bar's inner edge (the one facing into the screen), for a bar measured at `r`. */
export const innerOff = (edge: BarEdge, r: Span, height: number) => (edge === "top" ? r.bottom : height - r.top);

/** Whether `y` lies past the bar at `r` on the screen's side, where menus and panels open: false on the bar and in the gap at the edge. */
export const beyond = (edge: BarEdge, y: number, r: Span) => (edge === "top" ? y > r.bottom : y < r.top);

/** The bar's CSS margin: off the sides and its screen edge (a capsule only off its edge). */
export const barMargin = (edge: BarEdge, gap: number, capsule: boolean) => {
  const side = capsule ? 0 : gap;
  return edge === "top" ? `${gap}px ${side}px 0` : `0 ${side}px ${gap}px`;
};
