import type { Design } from "../../design/design.ts";
import type { Indicator, MarkStyle } from "./model.ts";

/**
 * Which marks an app shows: the dot while open, the long mark while it asks for attention and, in Crest, while in front. Material
 * puts a tonal pill behind the app in front instead, as an M3 navigation bar's active indicator; attention keeps the pulsing mark,
 * since a still pill would not ask for anything.
 */
export function marks(kind: Indicator, appDesign: Design): { dot: boolean; bar: boolean; pill: boolean } {
  const material = appDesign === "material";
  return { dot: kind === "open", bar: kind === "attention" || (kind === "front" && !material), pill: kind === "front" && material };
}

/**
 * The box of the pill and of the state layer, one shape as in M3's navigation bar: as wide as the button, as tall as an M3 indicator
 * (`size + 8`, or `layer` when the item draws a pill of its own) but never taller than wide, centred, fully round. A tile is
 * already the container, so both cover it with its radius.
 */
export function itemLayer(o: { size: number; width: number; layer?: number; tile?: { radius: number } }): {
  inset?: number;
  left?: number;
  right?: number;
  top?: string;
  height?: number;
  marginTop?: number;
  borderRadius: number;
} {
  if (o.tile) return { inset: 0, borderRadius: o.tile.radius };
  const h = Math.min(o.layer ?? o.size + 8, o.width);
  return { left: 0, right: 0, top: "50%", height: h, marginTop: -h / 2, borderRadius: h / 2 };
}

type Size = { w: number; h: number };
const SHAPES: Record<MarkStyle, { dot: Size; bar: Size }> = {
  dot: { dot: { w: 3, h: 3 }, bar: { w: 16, h: 3 } },
  large: { dot: { w: 6, h: 6 }, bar: { w: 18, h: 4 } },
  line: { dot: { w: 8, h: 3 }, bar: { w: 16, h: 3 } },
};

/** The open mark and the longer one in front, CSS px, by the setting's style. */
export const markShape = (style: MarkStyle) => SHAPES[style];

/** The row the marks take: the taller of the two. */
export const markThick = (style: MarkStyle) => Math.max(SHAPES[style].dot.h, SHAPES[style].bar.h);
