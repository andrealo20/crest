// The Timer's durations: typed as minutes, M:SS or H:MM:SS, moved by the wheel, and the last ones started remembered per mode. Pure,
// so the rules are tested without the app around them.

import { formatClock } from "../teleprompter/model.ts";

export const MIN_SECONDS = 5;
export const MAX_SECONDS = 24 * 3600;
/** Remembered durations per mode, shown as chips beside the presets. */
export const MAX_REMEMBERED = 3;

export const clampDuration = (s: number) => Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(s)));

/** "25" is minutes, "2:30" minutes and seconds, "1:05:00" hours, minutes and seconds; null for anything else or outside the limits. */
export function parseDuration(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length > 3 || !/^\d{1,4}$/.test(parts[0]) || parts.slice(1).some((p) => !/^[0-5]\d$/.test(p))) return null;
  const [a, b = 0, c = 0] = parts.map(Number);
  const s = parts.length === 1 ? a * 60 : parts.length === 2 ? a * 60 + b : a * 3600 + b * 60 + c;
  return s >= MIN_SECONDS && s <= MAX_SECONDS ? s : null;
}

/** Whole minutes as the minutes ("25"), anything else as the countdown reads it ("2:30", "1:05:30"), so the field reads it back. */
export const durationText = (s: number) => (s % 60 ? formatClock(s) : String(s / 60));

/** The wheel's step to the next whole minute up or down; a step below a minute stops at one, and a duration under a minute stays as it is rather than going to none. */
export function wheelStep(d: number, step: number): number {
  const m = step > 0 ? Math.floor(d / 60) + step : Math.ceil(d / 60) + step;
  return m < 1 ? Math.min(d, 60) : clampDuration(m * 60);
}

/** The remembered durations as saved: a single number from an older Crest, or a list, kept to the limits, never a preset, at most three. */
export function customsOf(saved: unknown, presets: readonly number[]): number[] {
  const list: unknown[] = typeof saved === "number" ? [saved] : Array.isArray(saved) ? saved : [];
  const out: number[] = [];
  for (const d of list) {
    if (typeof d === "number" && d >= MIN_SECONDS && d <= MAX_SECONDS && !presets.includes(d) && !out.includes(d)) out.push(d);
  }
  return out.slice(0, MAX_REMEMBERED);
}

/** The list after `d` was started: it goes first, unless it is a preset, which has its chip already. */
export const remember = (list: readonly number[], d: number, presets: readonly number[]): number[] =>
  presets.includes(d) ? [...list] : [d, ...list.filter((x) => x !== d)].slice(0, MAX_REMEMBERED);
