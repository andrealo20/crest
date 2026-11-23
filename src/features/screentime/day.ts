// The Day timeline's strip as numbers: its window, the blocks in it, daylight, the events and the ticks. Pure, every function takes its times.

import { addDays, startOfDay } from "../calendar/model.ts";
import { sunDay } from "../clocks/astro.ts";
import type { Place } from "../themes/daynight.ts";

/** The widget's versions (taskbar model.ts WidgetVariants["timeline"]): the local day, or two hours back to six ahead. */
export type StripVersion = "fullday" | "ahead";

const H = 3_600_000, MIN = 60_000;

/** The window the strip shows at `now`: the local day from its midnight (23 or 25 hours on the days the clocks change), or from two hours ago to six ahead, to the minute. */
export function stripWindow(v: StripVersion, now: number): [number, number] {
  if (v === "ahead") {
    const at = Math.floor(now / MIN) * MIN;
    return [at - 2 * H, at + 6 * H];
  }
  const day = startOfDay(now);
  return [day, addDays(day, 1)];
}

/** Where `t` falls on a strip `width` wide from `from` to `to`. */
export const xOf = (t: number, from: number, to: number, width: number): number => ((t - from) / (to - from)) * width;

/** Each span that touches the window as its x and width there, cut at the edges and at least `min` wide, kept inside. */
export function blocks(spans: [number, number][], from: number, to: number, width: number, min = 2): { x: number; w: number }[] {
  return spans
    .filter(([start, end]) => start < to && end > from)
    .map(([start, end]) => {
      const x0 = Math.max(0, xOf(start, from, to, width)), x1 = Math.min(width, xOf(end, from, to, width));
      const w = Math.max(min, x1 - x0);
      return { x: Math.max(0, Math.min(x0, width - w)), w };
    });
}

/**
 * Sunrise to sunset at the Weather's place for every local day the window touches, to the minute and worked out here, with no
 * network; the whole day under the midnight sun, nothing in the polar night. Empty without a place.
 */
export function sunSpans(from: number, to: number, place: Place): [number, number][] {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return [];
  const out: [number, number][] = [];
  for (let day = startOfDay(from); day < to; day = addDays(day, 1)) {
    const next = addDays(day, 1), sun = sunDay(day, next, place.lat, place.lon);
    const minute = (ms: number) => Math.round(ms / MIN) * MIN;
    if (sun.sunrise !== null && sun.sunset !== null) out.push([minute(sun.sunrise), minute(sun.sunset)]);
    else if (sun.polar === "day") out.push([day, next]);
  }
  return out;
}

/** The events that are not all-day and touch the window (one of no length counts where it starts), as the calendar's eventsOn counts them. */
export function eventSpans<T extends { start: number; end: number; allDay: boolean }>(events: T[], from: number, to: number): T[] {
  return events.filter((e) => !e.allDay && e.start < to && (e.end > from || (e.end === e.start && e.start >= from)));
}

/** The timed events touching the window with their calendar's colour (as the next event's dot), never their titles. */
export function dayEvents(
  data: { events: { start: number; end: number; allDay: boolean; calendar: string }[]; calendars: { id: string; color: string }[] } | null,
  from: number,
  to: number,
): { start: number; end: number; color: string }[] {
  return eventSpans(data?.events ?? [], from, to).map((e) => ({ start: e.start, end: e.end, color: data?.calendars.find((c) => c.id === e.calendar)?.color || "var(--color-link)" }));
}

/** The strip's ticks: 6, 12 and 18 o'clock on the whole day, every whole hour inside the next hours. */
export function ticks(v: StripVersion, from: number, to: number): number[] {
  if (v === "fullday") return [6, 12, 18].map((h) => new Date(from).setHours(h, 0, 0, 0));
  const out: number[] = [];
  for (let t = new Date(from).setMinutes(60, 0, 0); t < to; t = new Date(t).setMinutes(60, 0, 0)) out.push(t);
  return out;
}
