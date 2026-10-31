/**
 * Undo for the theme editor. Changes that follow each other within `COALESCE_MS` (dragging
 * across the colour square) are one step, so Undo goes back to where the drag began.
 */
export const COALESCE_MS = 600;
const LIMIT = 100;

export interface History<T> {
  past: T[];
  present: T;
  /** Time of the last change, for coalescing. */
  at: number;
}

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, at: -Infinity });

export function record<T>(h: History<T>, next: T, now: number): History<T> {
  if (h.past.length > 0 && now - h.at < COALESCE_MS) return { ...h, present: next, at: now };
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, at: now };
}

/** One step back; the same history when there is nothing to undo. */
export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], at: -Infinity };
}

/** The state before the first change. */
export const original = <T>(h: History<T>): T => h.past[0] ?? h.present;
