import { createStore } from "../../lib/store";
import { closeTimerWindow, onTimerWindow, openTimerWindow } from "../../platform/services";
import { isTimerWindow } from "../../lib/windowKind";
import { readSpot, type Spot } from "./window/moves";

/*
 * Detached timer: a small always-on-top window (timer.html) with the running timer.
 * Rust reports open/closed, so the button in the notch stays right when the window
 * closes itself. The window saves its position under POS_KEY on every move.
 */
export const detached = createStore(false);

export const POS_KEY = "notch:timer-window";

if (!isTimerWindow) onTimerWindow((open) => detached.set(open));

/** Saved spot (physical px, with the pixel ratio there) or null. Read fresh: the other window writes it. */
function savedPos(): Spot | null {
  try {
    return readSpot(localStorage.getItem(POS_KEY));
  } catch {
    return null;
  }
}

export function toggleDetached() {
  if (detached.get()) void closeTimerWindow();
  else void openTimerWindow(savedPos());
}
