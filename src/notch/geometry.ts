/*
 * Notch dimensions per state (CSS px = DIPs, scaled with Windows DPI).
 * Derived from NotchDrop (MIT) and the MacBook notch proportions.
 *
 *   w    width of the black body (without ears)
 *   h    height
 *   r    radius of the bottom corners
 *   ear  radius of the outward-curved "ears" at the top edge
 *   rt   radius of the top corners (0 where the shape hangs from the screen edge)
 */
export interface NotchGeometry {
  w: number;
  h: number;
  r: number;
  ear: number;
  rt: number;
}

/** Header height when open = height of the closed notch. */
export const HEADER_HEIGHT = 32;

/** Tool bar at the bottom of the open notch (like OmniNotch). */
export const DOCK_HEIGHT = 46;

/** Padding when open. Inner radii = r − PADDING (concentric). */
export const PADDING = 16;

export const geometry = {
  /** Closed with a live activity (music): side slots for cover + equalizer. */
  live: { w: 284, h: 30, r: 10, ear: 6, rt: 0 },
  /** Gaming mode: wider slots for FPS/CPU on the left and GPU/RAM on the right. */
  gaming: { w: 436, h: 30, r: 10, ear: 6, rt: 0 },
  /** Focus mode "line": a thin strip at the screen edge, just enough to find it again. */
  line: { w: 150, h: 5, r: 2.5, ear: 3, rt: 0 },
  /** Hover on the line: it stays a line, just a touch bigger, then opens straight away. */
  linePeek: { w: 166, h: 7, r: 3.5, ear: 3.5, rt: 0 },
} satisfies Record<string, NotchGeometry>;

/** Idle at width w: the notch hangs from the edge with ears (MacBook proportions), the capsule is round all over. */
export function closedGeometry(style: "notch" | "capsule", w: number): NotchGeometry {
  return style === "capsule" ? { w, h: 30, r: 15, ear: 0, rt: 15 } : { w, h: 30, r: 10, ear: 6, rt: 0 };
}

/** Hover on a closed shape of width w: slightly larger, as feedback. */
export function peekGeometry(style: "notch" | "capsule", w: number): NotchGeometry {
  return style === "capsule" ? { w: w + 16, h: 34, r: 17, ear: 0, rt: 17 } : { w: w + 16, h: 34, r: 12, ear: 7, rt: 0 };
}

/** Open state: size comes from the active tab, radii are fixed; floating (a capsule away from the edge) rounds the top too. */
export function openGeometry(w: number, h: number, floating = false): NotchGeometry {
  return floating ? { w, h, r: 30, ear: 0, rt: 30 } : { w, h, r: 30, ear: 14, rt: 0 };
}
