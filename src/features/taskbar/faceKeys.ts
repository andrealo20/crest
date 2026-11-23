// The keys some of the bar's faces draw, and which one a click lands on. Pure, so they can be tested without the app around them.

import type { PartId } from "../../notch/row/parts.ts";
import { variantOf, type WidgetVariants } from "./model.ts";

/**
 * What a key on a face does: play or pause the song, the previous or the next one, mute the microphone or the sound, open Weather
 * (onWeather), the previous or the next wallpaper.
 */
export type FaceKey = "toggle" | "previous" | "next" | "mic" | "sound" | "weather" | "wallPrevious" | "wallNext";

/** The song title's versions, px at scale 1: a key's column, the round play key, the cover, the room after them, each text column. */
export const TRACK = { key: 22, disc: 24, cover: 20, gap: 6, text: { play: 130, cover: 100, track: 132 } } as const;
/** Each version past the scrolling line as wide as its parts, so a new song never moves a neighbour. */
export const TRACK_WIDTH: Record<Exclude<WidgetVariants["title"], "text">, number> = {
  play: TRACK.disc + TRACK.gap + TRACK.text.play,
  cover: TRACK.cover + TRACK.gap + TRACK.text.cover + 3 * TRACK.key,
  disc: TRACK.key,
  track: TRACK.text.track + TRACK.gap + TRACK.key,
};
/** The microphone's glyph, and each glyph's column when the speaker stands beside it. */
export const MIC = { glyph: 16, key: 20 } as const;
export const MIC_WIDTH: Record<WidgetVariants["mic"], number> = { mic: MIC.glyph, both: 2 * MIC.key };
/** The wallpaper's version with keys: a key's column each side of the picture, and the whole face. */
export const WALL = { key: 20, thumb: 40, width: 80 } as const;

/** A face's width and its keys as [from, to, key] in its own px, left to right. */
function faceKeys(id: PartId, variants: unknown): { width: number; keys: [number, number, FaceKey][] } {
  if (id === "mic") {
    return variantOf(variants, "mic") === "both"
      ? { width: MIC_WIDTH.both, keys: [[0, MIC.key, "mic"], [MIC.key, MIC_WIDTH.both, "sound"]] }
      : { width: MIC_WIDTH.mic, keys: [[0, MIC_WIDTH.mic, "mic"]] };
  }
  if (id === "wallpaper") {
    return variantOf(variants, "wallpaper") === "keys"
      ? { width: WALL.width, keys: [[0, WALL.key, "wallPrevious"], [WALL.width - WALL.key, WALL.width, "wallNext"]] }
      : { width: 0, keys: [] };
  }
  if (id !== "title") return { width: 0, keys: [] };
  const v = variantOf(variants, "title"), w = v === "text" ? 0 : TRACK_WIDTH[v];
  switch (v) {
    case "play":
      return { width: w, keys: [[0, TRACK.disc, "toggle"]] };
    case "cover": {
      const first = w - 3 * TRACK.key;
      return { width: w, keys: [[first, first + TRACK.key, "previous"], [first + TRACK.key, first + 2 * TRACK.key, "toggle"], [first + 2 * TRACK.key, w, "next"]] };
    }
    case "disc":
      return { width: w, keys: [[0, w, "toggle"]] };
    case "track":
      return { width: w, keys: [[w - TRACK.key, w, "next"]] };
    default:
      return { width: 0, keys: [] };
  }
}

/**
 * The key a click on widget `id` in its version lands on, `x` the pointer in the face's own px from its left edge (null by keyboard or
 * while the widget shows its icon); null where the face has no key, and the click does what it does on the rest of the widget.
 * The microphone is all key: anywhere else on it, and by keyboard, a click mutes it.
 */
export function widgetKey(id: PartId, variants: unknown, x: number | null): FaceKey | null {
  const { width, keys } = faceKeys(id, variants);
  // A key at an edge of the face owns the button's padding beyond it, and the screen's edge past that.
  const hit = x === null ? undefined : keys.find(([from, to]) => (from === 0 || x >= from) && (to === width || x < to));
  return hit ? hit[2] : id === "mic" ? "mic" : null;
}

/**
 * Whether a click lands on the weather a face draws at its end (the clock's Time and weather, the date's week): `x` as widgetKey takes
 * it, `from` where the weather starts in px from the face's start edge (undefined: no weather), `width` the face's. The padding beyond
 * the weather is the weather's too; right to left (`rtl`) the face is mirrored, the weather at its left end.
 */
export const onWeather = (x: number | null, from: number | undefined, width: number, rtl: boolean): boolean =>
  x !== null && from !== undefined && (rtl ? x <= width - from : x >= from);
