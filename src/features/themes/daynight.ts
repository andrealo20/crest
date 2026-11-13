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
 * The day's start and end in minutes on the day of `now`: sunrise and sunset when the schedule follows the sun and the
 * place has both that day, else the set times; invalid or equal times (a day that never ends) fall back to the defaults.
 */
function hours(schedule: ThemeSettings["schedule"], now: Date, place: Place): [number, number] {
  const sun = schedule.sun ? sunHours(now, place) : null;
  if (sun) return sun;
  const day = parseTime(schedule.dayStart), night = parseTime(schedule.nightStart);
  if (day !== null && night !== null && day !== night) return [day, night];
  return [parseTime(THEME_DEFAULTS.schedule.dayStart)!, parseTime(THEME_DEFAULTS.schedule.nightStart)!];
}

/** Whether it is night at this local time. The day may run past midnight (a night shift's 20:00 to 08:00). */
export function isNight(schedule: ThemeSettings["schedule"], now: Date, place?: Place): boolean {
  const [day, night] = hours(schedule, now, place);
  const m = now.getHours() * 60 + now.getMinutes();
  const daytime = day < night ? m >= day && m < night : m >= day || m < night;
  return !daytime;
}

/** The next local time the theme changes, after `now`: the first of today's and tomorrow's changes, each day by its own times. */
export function nextChange(schedule: ThemeSettings["schedule"], now: Date, place?: Place): Date {
  const changes = [0, 1].flatMap((offset) => {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    return hours(schedule, day, place).map((m) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60));
  });
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
