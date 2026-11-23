// Screen Time's days as the page reads them (screentime.rs): totals, the first apps, the hours and how the time is written. Pure.

import type { ScreenDay } from "../../platform/services.ts";

/** A day as the widget and the part show it: the total and the first apps in seconds, and the seconds per local hour, 24 of them. */
export type ScreenSummary = { total: number; apps: { key: string; name: string; path: string | null; secs: number }[]; hours: number[] };

const pad = (n: number) => String(n).padStart(2, "0");

/** The local day of `ms` as "YYYY-MM-DD", as Rust names its days. */
export const dateKey = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** The local midnight of a day's key. */
export const dayStart = (key: string): number => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
};

/** The day `n` days before `key` (after it for a negative `n`). */
export const daysBack = (key: string, n: number): string => {
  const [y, m, d] = key.split("-").map(Number);
  return dateKey(new Date(y, m - 1, d - n).getTime());
};

const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);

export const appTotal = (a: { h: number[] }): number => sum(a.h);
export const dayTotal = (day: ScreenDay | null): number => (day ? sum(Object.values(day.apps).map(appTotal)) : 0);
/** The seconds of every app per local hour. */
export const hourTotals = (day: ScreenDay | null): number[] => Array.from({ length: 24 }, (_, i) => (day ? sum(Object.values(day.apps).map((a) => a.h[i] ?? 0)) : 0));

/** The day's named apps by their time, the same time by name; "" (the others past 300) is counted in the total, never named. */
export const ranked = (day: ScreenDay | null): [string, ScreenDay["apps"][string]][] =>
  Object.entries(day?.apps ?? {})
    .filter(([key]) => key !== "")
    .sort(([, a], [, b]) => appTotal(b) - appTotal(a) || a.name.localeCompare(b.name));

export function summary(day: ScreenDay | null, n = 3): ScreenSummary {
  return {
    total: dayTotal(day),
    apps: ranked(day).slice(0, n).map(([key, a]) => ({ key, name: a.name, path: a.path, secs: appTotal(a) })),
    hours: hourTotals(day),
  };
}

/** The mean of the last `n` days that have any time; 0 without one. */
export function average(days: ScreenDay[], n = 7): number {
  const totals = [...days].sort((a, b) => a.date.localeCompare(b.date)).slice(-n).map(dayTotal).filter((t) => t > 0);
  return totals.length ? Math.round(sum(totals) / totals.length) : 0;
}

const unit = (lang: string, u: "hour" | "minute", n: number, digits: number) =>
  new Intl.NumberFormat(lang, { style: "unit", unit: u, unitDisplay: "narrow", minimumIntegerDigits: digits }).format(n);

/** "3h 05m", "42m" in English: the language's narrow units from Intl, the minutes in two digits beside hours. */
export function shortDuration(secs: number, lang: string): string {
  const m = Math.floor(secs / 60), h = Math.floor(m / 60);
  return h ? `${unit(lang, "hour", h, 1)} ${unit(lang, "minute", m % 60, 2)}` : unit(lang, "minute", m, 1);
}

/** "3 h 5 min" through Crest's own strings (`tr` is t()), for what a screen reader says and the page's large figure. */
export function longDuration(secs: number, tr: (de: string, vars?: Record<string, string | number>) => string): string {
  const m = Math.floor(secs / 60), h = Math.floor(m / 60);
  return h ? tr("{h} Std. {m} Min.", { h, m: m % 60 }) : tr("{n} Min.", { n: m });
}

/** Every digit an 8: the room of the widest figure the text could show, so the box grows only when its shape changes. */
export const eights = (text: string): string => text.replace(/\p{Nd}/gu, "8");

/** The widget's versions (taskbar model.ts WidgetVariants["screentime"]). */
export type ScreenVersion = "total" | "apps" | "hourly";
/** The hourglass and the gap after it; the three app slots of `apps`; the histogram of `hourly`. */
export const GLASS = 15, GLASS_GAP = 4, SLOT = 16, SLOT_GAP = 4, APPS_GAP = 8, HIST_W = 71, HIST_GAP = 6;

/** The face's width at scale 1, from its text's (measured with every digit an 8). */
export function screenFaceWidth(v: ScreenVersion, textWidth: number): number {
  const total = GLASS + GLASS_GAP + textWidth;
  if (v === "apps") return total + APPS_GAP + 3 * SLOT + 2 * SLOT_GAP;
  if (v === "hourly") return total + HIST_GAP + HIST_W;
  return total;
}

/** An hour's bar in a histogram `max` tall: none at zero (the face draws a faint dash), at least 1.5, full at an hour or more. */
export const barHeight = (secs: number, max = 14): number => (secs > 0 ? Math.max(1.5, Math.min(max, (secs / 3600) * max)) : 0);
