// Habits: day arithmetic, the forgiving streak and the cleanup of saved data. Pure; every function takes `now` or `today`.
import type { Hue } from "../themes/hues";

export const MAX_HABITS = 20;
export const NAME_MAX = 40;
/** Days of history kept (two years). */
export const KEEP_DAYS = 730;
/** The dots: five weeks ending today. */
export const SHOWN_DAYS = 35;

/** Theme colours a habit can have; the view draws them with the theme's own `--hue-*` variable. */
export const HABIT_HUES = ["red", "orange", "amber", "green", "teal", "blue", "violet", "pink"] as const satisfies readonly Hue[];
export type HabitHue = (typeof HABIT_HUES)[number];

export interface Habit {
  id: string;
  name: string;
  hue: HabitHue;
  /** Weekdays it is active on, 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** The first day it counts (day number). */
  since: number;
  /** Days ticked (day numbers). */
  done: number[];
  /** Ticked by the Water tool when the daily goal is reached; no manual ticks. */
  water?: boolean;
}

export interface HabitState { habits: Habit[] }

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/**
 * A calendar day as a whole number: days since 1970-01-01 of the LOCAL date. Stored ticks keep their number when the
 * time zone changes, and counting days is plain integer arithmetic, so a 23 or 25 hour day (DST) is still one day.
 */
export function dayOf(t: number): number {
  const d = new Date(t);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday (1 January 1970 was a Thursday). */
export const weekday = (day: number): number => (((day + 4) % 7) + 7) % 7;

/** Whether `day` is one of the habit's days. It starts on `since`; a date that moved back (time zone) never makes today unusable. */
export const isActive = (h: Pick<Habit, "days" | "since">, day: number, today: number): boolean =>
  day >= Math.min(h.since, today) && h.days.includes(weekday(day));

/**
 * The streak rule, kept forgiving on purpose.
 * - Only a habit's own days count. A day off adds nothing and breaks nothing; so does a tick on one.
 * - A ticked day adds 1.
 * - Today, not ticked yet, is still open: it adds nothing and breaks nothing.
 * - A missed day (own day before today, not ticked) breaks the streak, unless at most ONE other miss lies in the 7
 *   own days before it (a week for a daily habit, seven weeks for a weekly one). Then it is forgiven: it adds nothing
 *   and the streak goes on. Every earlier miss counts in that window, forgiven or not, so a third miss within it always
 *   breaks. Counting own days, not calendar days, keeps a habit of one or two days a week from being forgiven forever.
 * `best` is the longest run in the kept history (two years). Ticks after today (the clock moved back) are ignored.
 */
export function streaks(h: Habit, today: number): { current: number; best: number } {
  const done = new Set(h.done);
  // `k` counts the habit's own days; the last two misses are kept as such counts.
  let run = 0, best = 0, k = 0, last = -Infinity, before = -Infinity;
  for (let d = Math.max(Math.min(h.since, today), today - KEEP_DAYS + 1); d <= today; d++) {
    if (!h.days.includes(weekday(d))) continue;
    k++;
    if (done.has(d)) best = Math.max(best, ++run);
    else if (d < today) {
      if (before >= k - 7) run = 0; // two misses in the 7 own days before this one
      before = last;
      last = k;
    }
  }
  return { current: run, best };
}

export type DotState = "done" | "missed" | "open" | "off";

/** The last SHOWN_DAYS days, oldest first. "open" is today, not ticked yet. */
export function dots(h: Habit, today: number): { day: number; state: DotState }[] {
  const done = new Set(h.done);
  return Array.from({ length: SHOWN_DAYS }, (_, i) => {
    const day = today - SHOWN_DAYS + 1 + i;
    const state: DotState = done.has(day) ? "done" : !isActive(h, day, today) ? "off" : day === today ? "open" : "missed";
    return { day, state };
  });
}

/** Ticks outside the kept history dropped. */
export const pruneDone = (done: number[], today: number): number[] => done.filter((d) => d > today - KEEP_DAYS);

/** `done` with `day` ticked or not. */
export const withDay = (done: number[], day: number, on: boolean): number[] =>
  on ? (done.includes(day) ? done : [...done, day]) : done.filter((d) => d !== day);

/** Habits that follow Water get today ticked while the goal is reached and un-ticked when it no longer is. The same array when nothing changes. */
export function followWater(habits: Habit[], today: number, reached: boolean): Habit[] {
  if (!habits.some((h) => h.water && h.done.includes(today) !== reached)) return habits;
  return habits.map((h) => (h.water && h.done.includes(today) !== reached ? { ...h, done: withDay(h.done, today, reached) } : h));
}

/** A saved value (or nothing) → a valid list: bad entries dropped, fields repaired, at most MAX_HABITS, old ticks pruned. */
export function normalizeHabits(saved: unknown, today: number): HabitState {
  const list = typeof saved === "object" && saved !== null && Array.isArray((saved as HabitState).habits) ? (saved as HabitState).habits : [];
  const ids = new Set<string>();
  const habits: Habit[] = [];
  for (const raw of list as Partial<Habit>[]) {
    if (habits.length >= MAX_HABITS) break;
    const name = typeof raw?.name === "string" ? raw.name.trim().slice(0, NAME_MAX) : "";
    if (!name || typeof raw.id !== "string" || !raw.id || ids.has(raw.id)) continue;
    ids.add(raw.id);
    const days = Array.isArray(raw.days) ? ALL_DAYS.filter((d) => raw.days!.includes(d)) : [];
    const since = Number.isInteger(raw.since) ? (raw.since as number) : today;
    const done = Array.isArray(raw.done) ? [...new Set(raw.done.filter((d) => Number.isInteger(d)))].sort((a, b) => a - b) : [];
    habits.push({
      id: raw.id,
      name,
      hue: HABIT_HUES.includes(raw.hue as HabitHue) ? (raw.hue as HabitHue) : "blue",
      days: days.length ? days : ALL_DAYS,
      since,
      done: pruneDone(done, today),
      ...(raw.water === true ? { water: true } : {}),
    });
  }
  return { habits };
}
