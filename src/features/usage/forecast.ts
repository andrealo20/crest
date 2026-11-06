// Pace forecast for a quota window: from what was used since the window began, where the bar ends at the reset. Pure, so the card only has to ask.

/** A window that has run for less than this share of its length gives a rate that is mostly noise. */
export const MIN_ELAPSED = 0.1;
/** A reading older than this gets no forecast: what was used since then is unknown. */
export const MAX_AGE_MS = 15 * 60_000;

export interface PaceWindow {
  usedPercent: number;
  /** Unix ms, null = unknown. */
  resetsAt: number | null;
  /** Window length in seconds, null = unknown. */
  windowSecs: number | null;
}

/** "limit": at this rate the limit is reached at `at` (Unix ms), before the reset. "reset": the bar ends at `percent` when the window resets. */
export type Pace = { kind: "limit"; at: number } | { kind: "reset"; percent: number };

/** Lines a pace takes on the card: the limit time may wrap to two, the quiet line stays on one. */
export const paceLines = (p: Pace | null): number => (!p ? 0 : p.kind === "limit" ? 2 : 1);

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Same rule as the card's dimming: a card kept from an old reading (an error with data) is not fresh, a 429 pause clears itself. */
export function freshReading(error: string | null | undefined): boolean {
  return !error || error === "rate-limited";
}

/**
 * `readAt` is when the reading was taken, `now` the clock. Null when there is nothing honest to say: a missing or non-finite
 * number, a reading that is old, a reset in the past, a window barely begun, a limit already reached, or nothing used yet.
 * The rate is the use since the start of the window (reset time minus its length), kept constant to the reset.
 */
export function pace(w: PaceWindow, readAt: number, now: number): Pace | null {
  const { usedPercent: used, resetsAt, windowSecs } = w;
  if (!finite(used) || !finite(resetsAt) || !finite(windowSecs) || !finite(readAt) || !finite(now)) return null;
  if (windowSecs <= 0 || used <= 0 || used >= 100) return null;
  // A reading dated in the future (clock skew) counts as taken now.
  const at = Math.min(readAt, now);
  if (now - at > MAX_AGE_MS || now >= resetsAt) return null;
  const length = windowSecs * 1000, start = resetsAt - length, elapsed = at - start;
  // Also covers a reset farther away than the window is long (elapsed below zero) and a zero length.
  if (elapsed < MIN_ELAPSED * length) return null;
  const projected = (used * length) / elapsed;
  if (Math.round(projected) <= 100) return Math.round(projected) < 1 ? null : { kind: "reset", percent: Math.round(projected) };
  // 100 % is reached after `elapsed * 100 / used` of use, and the rate says that is before the reset. If that is already past, the reading is behind.
  const hit = start + (elapsed * 100) / used;
  return hit > now ? { kind: "limit", at: hit } : null;
}

/** Calendar days from today's local date to the local date of `at` (0 = today). Counts dates, not 24 h, so a daylight saving change does not shift it. */
export function dayGap(at: number, now: number): number {
  const a = new Date(at), n = new Date(now);
  return (Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())) / 86_400_000;
}
