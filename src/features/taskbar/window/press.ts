import type { PointerEvent as ReactPointerEvent } from "react";

/** The ways a press ends without a key. */
const PRESS_ENDS = ["pointerup", "pointercancel", "lostpointercapture"] as const;

// The press being followed (its end), and whether the last press dragged: the click its release makes does nothing.
let endPress: (() => void) | null = null;
let dragged = false;

/**
 * A press on a bar button (a tray icon on the bar or in the panel, a widget, a tool button, Stato), followed until the pointer lets
 * go: past `threshold` CSS px it drags, and `onDrag` gets each move. It ends on the release, a cancel, a lost capture (its button
 * taken away meanwhile) or Esc while dragging, then `onEnd` runs; `dragged` outlives it. A second press ends the first.
 */
export function startPress(e: ReactPointerEvent<HTMLElement>, o: { threshold: number; onDrag: (x: number, y: number) => void; onEnd: () => void }): void {
  if (e.button !== 0) return;
  endPress?.();
  const { pointerId, clientX, clientY } = e;
  const button = e.currentTarget;
  // The button gets every move and the release, wherever the pointer goes, and the window gets them from it.
  button.setPointerCapture(pointerId);
  dragged = false;
  const onMove = (m: PointerEvent) => {
    if (m.pointerId !== pointerId || (!dragged && Math.hypot(m.clientX - clientX, m.clientY - clientY) <= o.threshold)) return;
    dragged = true;
    o.onDrag(m.clientX, m.clientY);
  };
  const onEnd = (m: PointerEvent) => m.pointerId === pointerId && end();
  // Taken on the way down, before the panel's own Esc, which then leaves the panel open.
  const onKey = (k: KeyboardEvent) => {
    if (k.key !== "Escape" || !dragged) return;
    k.preventDefault();
    end();
  };
  const end = () => {
    removeEventListener("pointermove", onMove);
    for (const type of PRESS_ENDS) removeEventListener(type, onEnd);
    removeEventListener("keydown", onKey, true);
    if (button.hasPointerCapture(pointerId)) button.releasePointerCapture(pointerId);
    endPress = null;
    o.onEnd();
  };
  addEventListener("pointermove", onMove);
  for (const type of PRESS_ENDS) addEventListener(type, onEnd);
  addEventListener("keydown", onKey, true);
  endPress = end;
}

/** Whether the last press dragged: its release's click is ignored. */
export const pressDragged = (): boolean => dragged;
