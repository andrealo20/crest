// The rules of "hide when a window touches it": when a bar slides off the screen, and where its page then takes the pointer. Pure,
// so they are tested without the app (window/useAutoHide.ts follows them).

import type { BarEdge } from "./model.ts";
import { edgeStrip } from "./position.ts";

/** A box in the bar window's CSS px, from its top-left: the frame of the window in front (taskbar/front.rs), or a hit zone. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The strip along the window's edge on the screen's edge that brings a bar back, CSS px: there the pointer stops at the screen's edge. */
export const STRIP = 2;
/** The wait before a bar slides away, ms: a pointer that has just left it, or a window passing over it, does not send it down. */
export const SLIDE_DELAY = 300;
/** How long a click on Start or the clock holds the bar up, ms: Windows' surface takes a moment to come to the front (window/hold.ts). */
export const BRIEF_HOLD = 800;
/** How long the pointer rests on an app before its window previews show, ms: Windows' own hover time (SPI_GETMOUSEHOVERTIME) as it ships. */
export const PREVIEW_DELAY = 400;
/** The wait before the previews close once the pointer left the button and the card, ms, as the slide's. */
export const PREVIEW_CLOSE = SLIDE_DELAY;

/** The window in front overlaps the bar's band by at least a pixel; edges that only meet do not touch. */
export function touches(front: Rect | null, band: Rect): boolean {
  return front !== null && front.x < band.x + band.w && band.x < front.x + front.w && front.y < band.y + band.h && band.y < front.y + front.h;
}

/**
 * The option on and the window in front touching the bar, with neither the pointer, an open menu, an app asking for attention nor
 * one of Windows' own surfaces (`held`: Start, Win+X, the calendar, a tray menu) holding it up.
 */
export function slides(p: { on: boolean; covered: boolean; pointer: boolean; open: boolean; attention: boolean; held: boolean }): boolean {
  return p.on && p.covered && !p.pointer && !p.open && !p.attention && !p.held;
}

/**
 * Where the page takes the pointer. A bar that slid away keeps only the strip at the window's edge on the screen's edge, so every other click
 * reaches the windows below. A bar that is up keeps its bands (the bar's, or one per group of tiles), the open menus and, while the
 * option is on, the strip as well: a pointer resting on the edge beside a bar narrower than the window then holds it up instead of
 * sending it up and down.
 */
export function zones(p: { bands: Rect[]; open: Rect[]; on: boolean; down: boolean; edge?: BarEdge; width: number; height: number }): Rect[] {
  const strip = edgeStrip(p.edge ?? "bottom", STRIP, p.width, p.height);
  if (p.down) return [strip];
  return [...p.bands, ...p.open, ...(p.on ? [strip] : [])];
}

/** The box round both a preview card and its button, so the gap between them stays in the page's zone. */
export function bridge(card: Rect, button: Rect): Rect {
  const x = Math.min(card.x, button.x);
  const y = Math.min(card.y, button.y);
  return { x, y, w: Math.max(card.x + card.w, button.x + button.w) - x, h: Math.max(card.y + card.h, button.y + button.h) - y };
}
