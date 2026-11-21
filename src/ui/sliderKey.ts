/** The value a slider takes for a key (arrows move by `step`, Home and End go to the ends); undefined for any other key. */
export function sliderKey(key: string, value: number, step: number, min: number, max: number): number | undefined {
  const to = key === "ArrowRight" || key === "ArrowUp" ? value + step : key === "ArrowLeft" || key === "ArrowDown" ? value - step : key === "Home" ? min : key === "End" ? max : undefined;
  return to === undefined ? undefined : Math.min(max, Math.max(min, to));
}

/** A wheel event on a slider: one notch once 40 px have gathered (a line counts 16 px), then the count starts again from 0. */
export function wheelStep(acc: number, deltaY: number, deltaMode: number): { dir: -1 | 0 | 1; acc: number } {
  // A touchpad sends many small events; the count holds them together, and one mouse notch (100 px in Chromium) is one step. Up raises.
  const next = acc - deltaY * (deltaMode === 1 ? 16 : 1);
  return next >= 40 ? { dir: 1, acc: 0 } : next <= -40 ? { dir: -1, acc: 0 } : { dir: 0, acc: next };
}

/** How far a notch moves: 2 % of the range, as a whole number of steps, never less than one step. */
export function wheelAmount(step: number, min: number, max: number): number {
  return Math.max(step, Math.round(((max - min) * 0.02) / step) * step);
}

/** Whether a wheel gesture starting now belongs to the slider: the pointer moved over it and it has the focus, or the pointer rested on it 400 ms with no wheel since. */
export function wheelTakes(c: { focused: boolean; now: number; pointerRestSince: number | null; lastWheel: number }): boolean {
  // A slider the page scrolls under a still pointer gets no pointermove, so a focused one does not take the page's scroll either.
  if (c.pointerRestSince === null) return false;
  // A pointer that lands on a slider while the page scrolls under it has not rested, so the page keeps scrolling.
  return c.focused || c.now - Math.max(c.pointerRestSince, c.lastWheel) >= 400;
}
