// Translated from BrimDeck (Apache-2.0, github.com/MoFeng2223/BrimDeck), src/BrimDeck.Core/PanelThemes.Daylight.cs.

import { sunDay } from "../clocks/astro.ts";
import { THEME_DEFAULTS, type ThemeSettings } from "./themes.ts";

/** Day and night: which of two themes is due at a local time, and when the next change comes. */

/** Where the sun is asked about: the Weather place, if one is set. */
export type Place = { lat: number; lon: number } | null | undefined;

/** "HH:mm" as minutes after midnight, or null. */
export function parseTime(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/**
 * Sunrise and sunset at the place on the local day of `now`, as minutes of this computer's clock (a place in another
 * time zone gives its sunrise at the hour it is here). Null without a place and where the sun does not rise or set that day.
 */
export function sunHours(now: Date, place: Place): [number, number] | null {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return null;
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const { sunrise, sunset } = sunDay(from, to, place.lat, place.lon);
  if (sunrise === null || sunset === null) return null;
  // The clock's reading rather than minutes since midnight, which are an hour off on the day the clocks change.
  const minute = (ms: number) => {
    const t = new Date(Math.round(ms / 60_000) * 60_000);
    return t.getHours() * 60 + t.getMinutes();
  };
  const day = minute(sunrise), night = minute(sunset);
  return day === night ? null : [day, night];
}

/**
 * The sun's risings (true) and settings at the place for yesterday, today and tomorrow, as instants to the minute, in order.
 * Empty without a place; a day without both (the midnight sun, the polar night) adds none.
 */
function sunEvents(now: Date, place: Place): [number, boolean][] {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return [];
  const midnight = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset).getTime();
  const minute = (ms: number) => Math.round(ms / 60_000) * 60_000;
  return [-1, 0, 1]
    .flatMap((d): [number, boolean][] => {
      const { sunrise, sunset } = sunDay(midnight(d), midnight(d + 1), place.lat, place.lon);
      return sunrise === null || sunset === null ? [] : [[minute(sunrise), true], [minute(sunset), false]];
    })
    .sort((a, b) => a[0] - b[0]);
}

/** Whether the schedule follows the sun on the day of `now`: the switch is on and the place has a sunrise and a sunset that day. */
const bySun = (schedule: ThemeSettings["schedule"], now: Date, place: Place) => schedule.sun && sunHours(now, place) !== null;

/** The set day's start and end in minutes; invalid or equal times (a day that never ends) fall back to the defaults. */
function hours(schedule: ThemeSettings["schedule"]): [number, number] {
  const day = parseTime(schedule.dayStart), night = parseTime(schedule.nightStart);
  if (day !== null && night !== null && day !== night) return [day, night];
  return [parseTime(THEME_DEFAULTS.schedule.dayStart)!, parseTime(THEME_DEFAULTS.schedule.nightStart)!];
}

/**
 * Whether it is night at this local time. By the sun it is night from a setting to the next rising, by their instants and not
 * by today's two times on the clock: at a place in another time zone, or far north, the sun can set after this computer's
 * midnight. By the set times the day may run past midnight (a night shift's 20:00 to 08:00).
 */
export function isNight(schedule: ThemeSettings["schedule"], now: Date, place?: Place): boolean {
  if (bySun(schedule, now, place)) {
    const last = sunEvents(now, place).filter(([at]) => at <= now.getTime()).at(-1);
    // Before the first rising known (the day after a polar night): still night.
    return last ? !last[1] : true;
  }
  const [day, night] = hours(schedule);
  const m = now.getHours() * 60 + now.getMinutes();
  const daytime = day < night ? m >= day && m < night : m >= day || m < night;
  return !daytime;
}

/** The next local time the theme changes, after `now`: by the sun its next rising or setting, else the first of the set times. */
export function nextChange(schedule: ThemeSettings["schedule"], now: Date, place?: Place): Date {
  if (bySun(schedule, now, place)) {
    const next = sunEvents(now, place).find(([at]) => at > now.getTime());
    if (next) return new Date(next[0]);
  }
  const changes = [0, 1].flatMap((offset) =>
    hours(schedule).map((m) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, Math.floor(m / 60), m % 60)),
  );
  // Tomorrow's are always later than now, so there is one to take.
  return changes.filter((t) => t > now).reduce((a, b) => (a < b ? a : b));
}

/** The theme due now: the chosen one, or with the schedule on the day or night theme. */
export function activeThemeId(themes: ThemeSettings, now: Date, place?: Place): string {
  if (!themes.schedule.on) return themes.id;
  return isNight(themes.schedule, now, place) ? themes.schedule.night : themes.schedule.day;
}

/** Choosing a theme: with the schedule on it takes the place of the theme due now. */
export function chooseTheme(themes: ThemeSettings, id: string, now: Date, place?: Place): ThemeSettings {
  if (!themes.schedule.on) return { ...themes, id };
  const slot = isNight(themes.schedule, now, place) ? "night" : "day";
  return { ...themes, schedule: { ...themes.schedule, [slot]: id } };
}

/** Every half hour of the day as "HH:mm", for the time menus. */
export const HALF_HOURS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
