// The stopwatch: start, pause, laps and what it reads. Pure, so the rules are tested without the app around them; the saved store
// and its actions are in store.ts.

import { formatClock } from "../teleprompter/model.ts";

export interface Stopwatch {
  /** Date.now() of the current run, null while paused or reset. */
  startedAt: number | null;
  /** The ms counted before the current run. */
  base: number;
  /** The time counted at each lap (ms), oldest first. */
  laps: number[];
}

export const STOPWATCH_IDLE: Stopwatch = { startedAt: null, base: 0, laps: [] };
export const MAX_LAPS = 99;

/** The ms counted at `now`; a clock set back never takes time off. */
export const elapsedOf = (s: Stopwatch, now: number) => (s.startedAt === null ? s.base : s.base + Math.max(0, now - s.startedAt));

export const toggleAt = (s: Stopwatch, now: number): Stopwatch =>
  s.startedAt === null ? { ...s, startedAt: now } : { ...s, startedAt: null, base: elapsedOf(s, now) };

/** A lap at `now`; the same stopwatch while paused or with every lap taken. */
export const lapAt = (s: Stopwatch, now: number): Stopwatch =>
  s.startedAt === null || s.laps.length >= MAX_LAPS ? s : { ...s, laps: [...s.laps, elapsedOf(s, now)] };

/** Never started, or reset: nothing to show and nothing to reset. */
export const idle = (s: Stopwatch) => s.startedAt === null && s.base === 0 && s.laps.length === 0;

/** Each lap's own time, from the times counted at each. */
export const splits = (laps: readonly number[]) => laps.map((l, i) => l - (i ? laps[i - 1] : 0));

/** The ms past the wall clock's second at which the counted time's second turns over, for useSecondTick; 0 while paused. */
export const swPhase = (s: Stopwatch) => (s.startedAt === null ? 0 : (((s.startedAt - s.base) % 1000) + 1000) % 1000);

/** Whole seconds counted: "12:34", from an hour "1:02:05". */
export const elapsedText = (ms: number) => formatClock(Math.floor(ms / 1000));

/** A lap's time to the tenth: "0:41.2". */
export const lapText = (ms: number) => `${elapsedText(ms)}.${Math.floor(ms / 100) % 10}`;
