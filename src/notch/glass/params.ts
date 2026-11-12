// The glass's rules and numbers (src/notch/glass): pure, no DOM, so node --test runs them.

import { PADDING } from "../geometry.ts";
import { parseColor } from "../../features/themes/color.ts";

/** band: the rim that bends (the panel's padding, so no content sits on it); lod: blur levels at scale 1 (lodFor); hair: the outline's strength. */
export const GLASS = {
  band: PADDING, maxShift: 6, maxShiftReduced: 3, lodRim: -0.5, lodMid: 1.9, hairDark: 0.21, hairLight: 0.35,
  // The drop (bar.ts): lifted, this much wider and this far out of the bar's top; a press squashes it by this share; speed stretches it.
  dropGrow: 6, dropRise: 3, squash: 0.15, stretch: 0.012, stretchMax: 8,
  // Its lens at Refraction 100 %: the bend at its rim in px and the magnification, the icon's too.
  dropShift: 10, dropMag: 0.15,
} as const;
/** The copy is asked for this long before the hover delay ends: a first peek after a while is estimated at 60-115 ms. */
export const GLASS_LEAD_MS = 120;
/** In hover mode: a pointer that only crosses the notch takes no copy. */
export const GLASS_MIN_DWELL_MS = 50;
/** In click mode: a pointer that only crosses the notch takes no copy. */
export const GLASS_CLICK_DWELL_MS = 100;
/** After a close, or Glass switched off: the shape is covered by the opaque --shape (300 ms) before the copy goes. */
export const CLOSE_SETTLE_MS = 400;
/** A copy that does not arrive in this time is given up; the panel keeps the tint. */
export const BUFFER_WAIT_MS = 1000;
/** At the opening a copy older than this (a long peek in click mode) is taken again; the old one shows meanwhile. */
export const SNAPSHOT_STALE_MS = 2000;

/** Everything the glass depends on; the first four must hold, the rest turn it off. */
export interface GlassInput {
  on: boolean; windows: boolean; hangsFromTop: boolean; webgl: boolean;
  forcedColors: boolean; contrastMore: boolean; reducedTransparency: boolean; saver: boolean;
  fullscreen: boolean; hidden: boolean; presenting: boolean; cover: boolean; dragging: boolean; editing: boolean;
}

/** Whether the glass may show now. Running on battery does not count: the glass costs at the opening, not at rest. */
export function glassAllowed(i: GlassInput): boolean {
  if (!i.on || !i.windows || !i.hangsFromTop || !i.webgl) return false;
  return !(i.forcedColors || i.contrastMore || i.reducedTransparency || i.saver || i.fullscreen || i.hidden || i.presenting || i.cover || i.dragging || i.editing);
}

/** How long the pointer rests on the notch before the copy is asked for. */
export function snapshotLead(openMode: "hover" | "click", hoverMs: number): number {
  return openMode === "hover" ? Math.max(GLASS_MIN_DWELL_MS, hoverMs - GLASS_LEAD_MS) : GLASS_CLICK_DWELL_MS;
}

export interface ShapeSize { w: number; h: number; ear: number }

/**
 * The canvas for a transition from `current` to `target`, in CSS px, at most `limit` (the window): both shapes with their ears and 6 %
 * for the springs' overshoot. `px` are device pixels rounded up to even numbers, so the centred canvas has its edges on whole pixels.
 */
export function canvasBox(current: ShapeSize, target: ShapeSize, limit: { w: number; h: number }, scale: number): { w: number; h: number; px: [number, number] } {
  const even = (v: number) => Math.ceil((v * scale) / 2) * 2;
  const w = Math.min(limit.w, Math.max(current.w, target.w) * 1.06 + 2 * Math.max(current.ear, target.ear) + 2);
  const h = Math.min(limit.h, Math.max(current.h, target.h) * 1.06 + 2);
  const px: [number, number] = [even(w), even(h)];
  return { w: px[0] / scale, h: px[1] / scale, px };
}

/** What comes with a copy (capture/backdrop.rs GlassMeta): the copied area inside the window, and the window, in physical px. */
export interface SnapshotMeta { kind: "glass-backdrop"; seq: number; x: number; y: number; w: number; h: number; ww: number; wh: number }

/**
 * From a point of the canvas (CSS px of the shape) to the copy's texture: uv = p * scale + offset. `rect` is the canvas on the page,
 * `dpr` the device pixels per page px, `zoom` the panel scale the page applies itself (viewZoom: 1 in the app, where dpr has it).
 */
export function textureMap(rect: { left: number; top: number }, zoom: number, dpr: number, meta: SnapshotMeta): { scale: [number, number]; offset: [number, number] } {
  return {
    scale: [(zoom * dpr) / meta.w, (zoom * dpr) / meta.h],
    offset: [(rect.left * dpr - meta.x) / meta.w, (rect.top * dpr - meta.y) / meta.h],
  };
}

/**
 * Blur levels at the rim and in the middle for device pixels per CSS px `scale`: the same blur in CSS px at every scale. `frost` (%)
 * scales the middle's blur radius; at 0 the middle is as sharp as the rim.
 */
export function lodFor(scale: number, frost = 100): [number, number] {
  const s = Math.log2(scale), rim = Math.max(0, s + GLASS.lodRim);
  return [rim, Math.max(rim, s + GLASS.lodMid + Math.log2(Math.max(frost, 1) / 100))];
}

/**
 * The drop on the tool bar (bar.ts), CSS px: [its centre's height over the bar's bottom, half width, half height]; all 0 without a tool.
 * Resting it is the tool's box (`w` x `h`, centred in the bar); lifted it stands on the bar's bottom, as tall as the bar and GLASS.dropRise
 * more; a press squashes it down and wider, and springing back (springs.rebound) it overshoots up to 1 px over that; `speed` (px/s along
 * the bar) stretches it.
 */
export function dropShape(w: number, h: number, barH: number, lift: number, press: number, speed: number): [number, number, number] {
  if (w <= 0) return [0, 0, 0];
  const wide = (w + GLASS.dropGrow * lift + Math.min(speed * GLASS.stretch, GLASS.stretchMax)) * (1 + GLASS.squash * press);
  const tall = Math.min((h + (barH + GLASS.dropRise - h) * lift) * (1 - GLASS.squash * press), barH + GLASS.dropRise + 1);
  return [((barH - h) / 2) * (1 - lift) + tall / 2, wide / 2, tall / 2];
}

/** The drop's lens for Refraction in %: [the bend at its rim in px, the magnification]; the icon under it grows by the same. */
export function dropLens(refraction: number): [number, number] {
  const k = refraction / 100;
  return [GLASS.dropShift * k, 1 + GLASS.dropMag * k];
}

/**
 * The part of a tool's button the drop covers, page px: [centre, width]. The layout width about the rect's centre (a press scales the
 * rect, not its centre), cut to the strip's view while it scrolls; out of view, width 0 at the view's edge.
 */
export function visiblePart(rect: { left: number; width: number }, layoutWidth: number, view: { left: number; right: number } | null): [number, number] {
  const mid = rect.left + rect.width / 2;
  const left = Math.max(mid - layoutWidth / 2, view?.left ?? -Infinity), right = Math.min(mid + layoutWidth / 2, view?.right ?? Infinity);
  return right > left ? [(left + right) / 2, right - left] : [Math.min(Math.max(mid, view?.left ?? mid), view?.right ?? mid), 0];
}

/** The shader's uShape: the body's left and right edge, its height and the ears, in a canvas `boxW` wide centred on it. */
export function shapeUniform(boxW: number, w: number, h: number, ear: number): [number, number, number, number] {
  const left = (boxW - w) / 2;
  return [left, left + w, h, ear];
}

/** A token as the shader takes it, channels and alpha from 0 to 1; null when it is not a colour (forced colours' keywords). */
export function parseTint(text: string | undefined): [number, number, number, number] | null {
  const c = parseColor(text);
  return c && [c.r / 255, c.g / 255, c.b / 255, c.a];
}

/** What Rust sends next to a buffer of `byteLength` bytes, checked at the border: an area inside the window that the bytes hold. */
export function metaOk(meta: unknown, byteLength: number): meta is SnapshotMeta {
  if (typeof meta !== "object" || meta === null) return false;
  const m = meta as Record<string, unknown>;
  if (m.kind !== "glass-backdrop" || !["seq", "x", "y", "w", "h", "ww", "wh"].every((k) => Number.isInteger(m[k]))) return false;
  const { x, y, w, h, ww, wh } = m as unknown as SnapshotMeta;
  return w >= 1 && h >= 1 && w <= 16384 && h <= 16384 && x >= 0 && y >= 0 && x + w <= ww && y + h <= wh && w * h * 4 <= byteLength;
}

/** Whether a buffer is the copy being waited for: well formed, for the latest request, and of the window at its size now (`windowPx`). */
export function takes(state: { seq: number; pending: boolean }, meta: unknown, windowPx: readonly [number, number], byteLength: number): meta is SnapshotMeta {
  return state.pending && metaOk(meta, byteLength) && meta.seq === state.seq && Math.abs(meta.ww - windowPx[0]) <= 2 && Math.abs(meta.wh - windowPx[1]) <= 2;
}
