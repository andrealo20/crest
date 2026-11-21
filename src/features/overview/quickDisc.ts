import type { Design } from "../../design/design.ts";
import type { Hue } from "../themes/hues.ts";
import { HUE_PALETTE } from "../themes/themes.ts";

/**
 * A quick switch's round disc (Overview's row, the bar's quick panel). Lit, Crest paints it in the switch's hue with a white icon;
 * Material in the primary colour with its pressed corners, as Android's quick settings do, except red, which says "muted" as in a call.
 */
export function discLook(design: Design, hue: Hue, on: boolean): { className: string; style?: { background: string } } {
  if (!on) return { className: "bg-fill-2 text-label-2" };
  if (design === "material" && hue !== "red") return { className: "bg-primary text-on-primary m3-morph" };
  return { className: "text-white", style: { background: HUE_PALETTE[hue][1] } };
}
