import { PANEL_MAX } from "../features/window/panelSize.ts";

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

/** Tool bar of the open notch, at its bottom (like OmniNotch) or under the header (behavior.toolBar). */
export const DOCK_HEIGHT = 46;

/** The tool bar's widths (Notch.tsx Dock: its px-3, the capsule's p-0.5, a button's 42 px, the strip's gap-0.5, the separator's mx-1 w-px; geometry.test.ts reads them there). */
const DOCK = { pad: 2 * 12 + 2 * 2, button: 42, gap: 2, separator: 4 + 1 + 4 } as const;

/** The tool bar with `tools` tools at their full size, then the separator and the gear. */
export const dockWidth = (tools: number) => DOCK.pad + tools * DOCK.button + Math.max(0, tools - 1) * DOCK.gap + DOCK.separator + DOCK.button;

/**
 * The open panel's width for a tool `w` wide: at least the tool bar's, so a narrower tool never squeezes the buttons and every such
 * tool opens as wide, which keeps them in place from tool to tool (#82). A bar wider than the widest panel opens every tool at the
 * widest panel, where the buttons narrow alike. Where the monitor's width `room` (CSS px, at the panel scale) cannot hold that, the
 * tool keeps its own width and the bar narrows and scrolls in it as before. `name`: the selected tool's name (nameWidth), which widens
 * the bar by its gap and its width.
 */
export function openWidth(w: number, tools: number, room: number, name = 0): number {
  const bar = Math.min(dockWidth(tools), PANEL_MAX.w);
  return bar <= room ? Math.max(w, name > 0 ? bar + NAME.gap + name : bar) : w;
}

/** The selected tool's name in the tool bar (behavior.toolNames): the gap after its icon (Notch.tsx DockButton's pl-1.5), its widest and its narrowest. */
export const NAME = { gap: 6, max: 72, min: 28 } as const;

/**
 * How wide the selected tool's name can be with `tools` tools on a monitor `room` wide: the room the widest panel and the monitor leave
 * beside the bar at full size, up to NAME.max, and 0 (no name) under NAME.min. The same for every tool, so the bar keeps its width
 * and its place from tool to tool; a longer name ends in an ellipsis.
 */
export function nameWidth(tools: number, room: number): number {
  const w = Math.min(NAME.max, Math.min(PANEL_MAX.w, room) - dockWidth(tools) - NAME.gap);
  return w >= NAME.min ? w : 0;
}

/**
 * Where the selected tool's name goes over or under its icon when the bar has no room beside it (Notch.tsx DockName): its left edge,
 * centred on the icon at `mid`, `w` wide, kept `margin` px inside the bar's `width` so the shape never cuts it.
 */
export function nameLabelLeft(mid: number, w: number, width: number, margin = 8): number {
  return Math.max(margin, Math.min(mid - w / 2, width - margin - w));
}

/** Padding when open. Inner radii = r − PADDING (concentric). */
export const PADDING = 16;

/**
 * The line (the idle style, or focus mode's thin strip at the edge, just enough to find it again), `w` long and `h` thick: hanging from the
 * edge with ears, or round all over when `floating` away from it. Hovered it stays a line, just a touch bigger, then opens straight away.
 */
export function lineGeometry(w: number, h: number, floating: boolean, peek: boolean): NotchGeometry {
  const t = peek ? h + 2 : h;
  return { w: peek ? w + 16 : w, h: t, r: t / 2, ear: floating ? 0 : peek ? 3.5 : 3, rt: floating ? t / 2 : 0 };
}

/** Idle at width w and height h: the notch hangs from the edge with ears (MacBook proportions), the capsule is round all over. The notch's corners keep their size at every height. */
export function closedGeometry(style: "notch" | "capsule", w: number, h = 30): NotchGeometry {
  return style === "capsule" ? { w, h, r: h / 2, ear: 0, rt: h / 2 } : { w, h, r: 10, ear: 6, rt: 0 };
}

/** Hover on a closed shape of width w and height h: slightly larger, as feedback. */
export function peekGeometry(style: "notch" | "capsule", w: number, h = 30): NotchGeometry {
  return style === "capsule" ? { w: w + 16, h: h + 4, r: h / 2 + 2, ear: 0, rt: h / 2 + 2 } : { w: w + 16, h: h + 4, r: 12, ear: 7, rt: 0 };
}

/** The notch on a side edge, in its frame: `w` along the edge, `h` away from it (column.ts); hovered it grows like the notch on top. */
export function columnGeometry(w: number, h: number, peek: boolean): NotchGeometry {
  return peek ? { w: w + 16, h: h + 4, r: 12, ear: 7, rt: 0 } : { w, h, r: 10, ear: 6, rt: 0 };
}

/** Open state: size comes from the active tab, radii are fixed; floating (a capsule away from the edge) rounds the top too. */
export function openGeometry(w: number, h: number, floating = false): NotchGeometry {
  return floating ? { w, h, r: 30, ear: 0, rt: 30 } : { w, h, r: 30, ear: 14, rt: 0 };
}
