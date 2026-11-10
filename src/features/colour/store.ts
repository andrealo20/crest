import { createStore } from "../../lib/store";
import { holdOpen, stayUntilVisit } from "../../notch/useNotchState";
import { isNative } from "../../platform/native";
import { screenColour } from "../../platform/services";
import { formatHex, normaliseColourState, parseColour, remember, type ColourState } from "./colour";

/** The colour on show, the second colour of the contrast check and the last 12 chosen (localStorage, nothing leaves the PC). */
export const colour = createStore<ColourState>({ current: null, other: null, history: [] }, { persist: "colour" });
colour.set(normaliseColourState);

export const colourActions = {
  /** A colour chosen on purpose (picked, entered, taken from a harmony or a suggestion): shown and kept in the history. */
  choose: (hex: string) => colour.set((s) => ({ ...s, current: hex, history: remember(s.history, hex) })),
  /** Shown only: a colour still being typed, or one clicked in the history (which keeps its place). */
  show: (hex: string) => colour.set((s) => ({ ...s, current: hex })),
  setOther: (hex: string) => colour.set((s) => ({ ...s, other: hex })),
  forget: (hex: string) => colour.set((s) => ({ ...s, history: s.history.filter((h) => h !== hex) })),
  clearHistory: () => colour.set((s) => ({ ...s, history: [] })),
};

interface EyeDropperApi {
  new (): { open(options?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }> };
}
const eyeDropper = () => (window as unknown as { EyeDropper?: EyeDropperApi }).EyeDropper;

/**
 * Natively Crest's own eyedropper (Windows) or AppKit's colour sampler (Mac). The browser demo uses the browser's, which only
 * Chromium has; WebView2's drifted away from the pointer on a monitor with another scale, so the app no longer uses it.
 */
export const canPickFromScreen = () => isNative || typeof eyeDropper() === "function";

/** `busy` while the eyedropper is open; `failed` after an error that was not a cancel. */
export const picking = createStore({ busy: false, failed: false });

/** The notch is let go after this long even if the eyedropper never answered. */
const PICK_LIMIT_MS = 60_000;

/** The browser's eyedropper: "#rrggbb", or null when cancelled (Esc, `cancel`). */
async function browserPick(cancel: AbortSignal): Promise<string | null> {
  const EyeDropper = eyeDropper();
  if (!EyeDropper) return null;
  try {
    const { sRGBHex } = await new EyeDropper().open({ signal: cancel });
    return cancel.aborted ? null : sRGBHex;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}

/**
 * Picks the colour under the pointer anywhere on screen, for the main colour or the second one. The eyedropper
 * takes the focus and the pointer away from the notch, which would close it (window blur, pointer leave):
 * `holdOpen` keeps it open until the pick is over, and a timer lets go after a minute whatever happens. Natively the
 * eyedropper ends by itself (Esc; a minute on Windows), and a colour picked after the timer still counts.
 */
export async function pickFromScreen(target: "current" | "other") {
  if (!canPickFromScreen() || picking.get().busy) return;
  picking.set({ busy: true, failed: false });
  holdOpen(true);
  const cancel = new AbortController();
  let held = true;
  const timer = window.setTimeout(() => {
    cancel.abort();
    release();
  }, PICK_LIMIT_MS);
  function release() {
    if (!held) return;
    held = false;
    window.clearTimeout(timer);
    holdOpen(false);
    picking.set((p) => ({ ...p, busy: false }));
  }
  try {
    const hex = isNative ? await screenColour.pick() : await browserPick(cancel.signal);
    const picked = hex ? parseColour(hex) : null;
    if (picked) {
      (target === "current" ? colourActions.choose : colourActions.setOther)(formatHex(picked));
      // The pointer is wherever the colour was: keep the notch open to show it.
      stayUntilVisit();
    }
  } catch {
    // A cancel is no error; anything else (the screen could not be copied, no user gesture in the browser) is told.
    picking.set((p) => ({ ...p, failed: true }));
  } finally {
    release();
  }
}
