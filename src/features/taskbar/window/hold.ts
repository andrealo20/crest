import { createStore } from "../../../lib/store";
import { BRIEF_HOLD } from "../autoHide";

/*
 * A click that opens one of Windows' own surfaces (Start, the calendar, a tray app's menu) holds the bar up for a moment, until Rust
 * sees the surface in front and holds it itself (taskbar://hold): otherwise the bar could slide away under the click.
 */

/** When the brief hold ends, in ms since the epoch; null while none is on. */
export const briefHold = createStore<number | null>(null);

let timer: number | undefined;

/** Holds the bar up for BRIEF_HOLD ms from now; a second call starts them again. */
export function holdBriefly(): void {
  window.clearTimeout(timer);
  briefHold.set(Date.now() + BRIEF_HOLD);
  timer = window.setTimeout(() => briefHold.set(null), BRIEF_HOLD);
}
