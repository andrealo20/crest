// The rules of the bar's look: gaps, corners, the surface's veil, the pointer's zones, the shapes the glass draws and the zone its
// live copy needs. Pure, so node --test runs them.

import type { BarShape } from "./model.ts";
import type { GlassZone } from "../../platform/native";
import { glassVeilAt } from "../themes/themes.ts";
import { GLASS, parseTint } from "../../notch/glass/params.ts";

/** A box on the page, CSS px. */
export interface Box { x: number; y: number; w: number; h: number }

/** gap: the room under and beside a bar off the edge; tileGap: between tiles; radius: the corners of a floating bar and a tile; maxTiles: the tiles the shader draws as glass. */
export const LOOK = { gap: 4, tileGap: 6, radius: 12, maxTiles: 24 } as const;

/** The room under and beside the bar: none for a docked bar. */
export function barGap(shape: BarShape): number {
  return shape === "docked" ? 0 : LOOK.gap;
}

/** The corners' radius: square docked, round ends on a capsule `height` tall. */
export function barRadius(shape: BarShape, height: number): number {
  return shape === "docked" ? 0 : shape === "capsule" ? height / 2 : LOOK.radius;
}

/**
 * The surface's opacity. `reduced` (reduced transparency, more contrast or forced colours) keeps it opaque; without the glass it is
 * 1 - transparency %, with it glassVeilAt from the theme's `safe` to its `clearest` veil. Glass switched on but not showing counts as on.
 */
export function barVeil(i: { transparency: number; glass: boolean; reduced: boolean; safe: number; clearest: number }): number {
  if (i.reduced) return 1;
  return i.glass ? glassVeilAt(i.safe, i.transparency, i.clearest) : 1 - i.transparency / 100;
}

/** A box with a size: a hidden element's is 0 x 0 at 0, 0, and would stretch a union to the window's corner. */
const sized = (boxes: Box[]) => boxes.filter((b) => b.w > 0 && b.h > 0);

/** A theme's veils as barVeil takes them: --glass-tint's opacity and --glass-tint-clear's; opaque where one does not read as a colour. */
export function themeVeils(vars: Record<string, string>): { safe: number; clearest: number } {
  return { safe: parseTint(vars["--glass-tint"])?.[3] ?? 1, clearest: parseTint(vars["--glass-tint-clear"])?.[3] ?? 1 };
}

/** The pointer's zones: each box down to the window's bottom (the strip under the bar takes clicks at the edge), empty boxes dropped. */
export function hitBoxes(boxes: Box[], windowHeight: number): Box[] {
  return sized(boxes).map((b) => ({ ...b, h: windowHeight - b.y }));
}

/** One box per group (the bar, the capsule, or a zone's tiles): the union of its boxes, a group with none dropped. */
export function groupBoxes(groups: Box[][]): Box[] {
  return groups.flatMap((g) => union(g) ?? []);
}

/** Room past the screen's edges for a docked bar's glass, CSS px. */
const BLEED = 4000;

/**
 * The rectangles the shader draws, in the coordinates they come in. Docked: one box stretched BLEED px left, right and down, so only
 * its top has the rim that bends (the hanging notch's trick). Tiles: the first LOOK.maxTiles as glass, the rest plain.
 */
export function glassShapes(shape: BarShape, all: Box[]): { rects: Box[]; plain: Box[] } {
  const boxes = sized(all);
  if (shape === "docked") {
    const u = union(boxes);
    return { rects: u ? [{ x: u.x - BLEED, y: u.y, w: u.w + 2 * BLEED, h: u.h + BLEED }] : [], plain: [] };
  }
  if (shape === "tiles") return { rects: boxes.slice(0, LOOK.maxTiles), plain: boxes.slice(LOOK.maxTiles) };
  return { rects: boxes, plain: [] };
}

/** The zone the bar's live copy needs: the boxes' union with GLASS.zoneMargin around it, physical px at `dpr`, rounded outwards; null without boxes. */
export function barNeed(boxes: Box[], dpr: number): GlassZone | null {
  const u = union(boxes);
  if (!u) return null;
  const m = GLASS.zoneMargin, x = Math.floor((u.x - m) * dpr), y = Math.floor((u.y - m) * dpr);
  return { x, y, w: Math.ceil((u.x + u.w + m) * dpr) - x, h: Math.ceil((u.y + u.h + m) * dpr) - y };
}

function union(all: Box[]): Box | null {
  const boxes = sized(all);
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

/** How much the icon under the pointer grows, as a dock's. */
export const MAGNIFY = 1.5;

/**
 * An icon's scale with the pointer `d` px from its centre, `unit` the pitch from one button to the next: MAGNIFY right under it,
 * about 1.33 one place away, about 1.05 two away, and 1 from two and a half on (also for a pointer off the bar, Infinity or NaN).
 */
export function magnify(d: number, unit: number): number {
  const r = 2.5 * unit;
  if (!(Math.abs(d) < r)) return 1;
  return 1 + (MAGNIFY - 1) * Math.cos((Math.PI / 2) * (Math.abs(d) / r)) ** 2;
}

/** How far a name over an icon of `size` rises in a bar `height` tall: past the bar's top, the icon grown to MAGNIFY from its bottom. */
export const labelRise = (size: number, height: number) => Math.max(0, Math.ceil(MAGNIFY * size - (height + size) / 2));
