// The rules of "hide when a window touches it": when a bar slides off the screen, and where its page then takes the pointer. Pure,
// so they are tested without the app (window/useAutoHide.ts follows them).

/** A box in the bar window's CSS px, from its top-left: the frame of the window in front (taskbar/front.rs), or a hit zone. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The strip along the window's bottom edge that brings a bar back, CSS px: there the pointer stops at the screen's edge. */
export const STRIP = 2;
/** The wait before a bar slides away, ms: a pointer that has just left it, or a window passing over it, does not send it down. */
export const SLIDE_DELAY = 300;

/** The window in front overlaps the bar's band by at least a pixel; edges that only meet do not touch. */
export function touches(front: Rect | null, band: Rect): boolean {
  return front !== null && front.x < band.x + band.w && band.x < front.x + front.w && front.y < band.y + band.h && band.y < front.y + front.h;
}

/** The option on and the window in front touching the bar, with neither the pointer, an open menu nor an app asking for attention holding it up. */
export function slides(p: { on: boolean; covered: boolean; pointer: boolean; open: boolean; attention: boolean }): boolean {
  return p.on && p.covered && !p.pointer && !p.open && !p.attention;
}

/**
 * Where the page takes the pointer. A bar that slid away keeps only the strip at the window's bottom edge, so every other click
 * reaches the windows below. A bar that is up keeps its band, the open menus and, while the option is on, the strip as well: a
 * pointer resting on the edge beside a bar narrower than the window then holds it up instead of sending it up and down.
 */
export function zones(p: { band: Rect; open: Rect[]; on: boolean; down: boolean; width: number; height: number }): Rect[] {
  const strip = { x: 0, y: p.height - STRIP, w: p.width, h: STRIP };
  if (p.down) return [strip];
  return [p.band, ...p.open, ...(p.on ? [strip] : [])];
}
