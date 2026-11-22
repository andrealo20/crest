// The keys some of the bar's faces draw, and which one a click lands on. Pure, so they can be tested without the app around them.

import type { PartId } from "../../notch/row/parts.ts";

/** What a key on a face does: play or pause the song, the previous or the next one, mute the microphone or the sound. */
export type FaceKey = "toggle" | "previous" | "next" | "mic" | "sound";

/**
 * The key a click on widget `id` in its version lands on, `x` the pointer in the face's own px from its left edge (null by keyboard or
 * while the widget shows its icon); null where the face has no key, and the click does what it does on the rest of the widget.
 */
export function widgetKey(_id: PartId, _variants: unknown, _x: number | null): FaceKey | null {
  return null;
}
