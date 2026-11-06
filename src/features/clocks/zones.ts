/*
 * Time zones through Intl, never through fixed offsets: every offset is read for the instant
 * it is needed, so daylight saving time (and its different dates in each country) comes out
 * right, also for a reference time a day ahead. Pure: the language and the 12 or 24 hour
 * clock come in as arguments.
 */

export const MAX_ZONES = 12;
const DAY = 86_400_000;
const MIN = 60_000;

/** IANA names the engine still lists under their old spelling; shown by the name people use today. */
const RENAMED: Record<string, string> = { Calcutta: "Kolkata", Katmandu: "Kathmandu", Saigon: "Ho Chi Minh City", Kiev: "Kyiv", Rangoon: "Yangon", Godthab: "Nuuk", Ujung_Pandang: "Makassar" };

const parts = new Map<string, Intl.DateTimeFormat>();

function partsFormat(zone: string): Intl.DateTimeFormat {
  let f = parts.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    parts.set(zone, f);
  }
  return f;
}

/** Whether the engine knows this zone name (a saved list can hold one a different WebView does not). */
export function isZone(id: unknown): id is string {
  if (typeof id !== "string" || id === "") return false;
  try {
    partsFormat(id);
    return true;
  } catch {
    return false;
  }
}

/** The zone of this computer. */
export const localZone = (): string => new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** Minutes the zone is ahead of UTC at this instant (Rome in summer: 120, India: 330, New York in winter: -300). */
export function zoneOffset(ms: number, zone: string): number {
  const p: Record<string, number> = {};
  for (const x of partsFormat(zone).formatToParts(ms)) if (x.type !== "literal") p[x.type] = Number(x.value);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return Math.round((wall - Math.floor(ms / 1000) * 1000) / MIN);
}

/** The zone's wall clock at this instant, read as if it were UTC: format it with `timeZone: "UTC"`. */
export const wallTime = (ms: number, zone: string): number => ms + zoneOffset(ms, zone) * MIN;

/** Whole days between the zone's calendar date and the date in `home` at `now`: 1 = tomorrow there, -1 = yesterday. */
export const dayDelta = (ms: number, zone: string, now: number, home: string): number => Math.floor(wallTime(ms, zone) / DAY) - Math.floor(wallTime(now, home) / DAY);

/** Hour of the zone's day, 0 to 24 with the minutes as a fraction. */
export const hourOfDay = (ms: number, zone: string): number => (((wallTime(ms, zone) % DAY) + DAY) % DAY) / 3_600_000;

/** Day (6 to 18) or night by the zone's clock: no place is known, so no sun is computed. */
export const isDay = (ms: number, zone: string): boolean => {
  const h = hourOfDay(ms, zone);
  return h >= 6 && h < 18;
};

/** "+5 h", "+5:30 h", "-3 h", "0 h": how far ahead of you the zone is. */
export function formatDiff(minutes: number): string {
  const a = Math.abs(minutes);
  const sign = minutes > 0 ? "+" : minutes < 0 ? "-" : "";
  return `${sign}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, "0")}` : ""} h`;
}

/** "+5:30", "-4": an offset from UTC for the picker. */
export const formatUtc = (minutes: number): string => `UTC${minutes === 0 ? "" : formatDiff(minutes).replace(" h", "")}`;

/** The city from the last part of the name: America/Argentina/Buenos_Aires gives Buenos Aires. */
export function cityName(zone: string): string {
  const last = zone.split("/").pop() ?? zone;
  return RENAMED[last] ?? last.replaceAll("_", " ");
}

/** The first part of the name (Europe, America), or "" for names without one. */
export const regionName = (zone: string): string => (zone.includes("/") ? zone.split("/")[0].replaceAll("_", " ") : "");

const clocks = new Map<string, Intl.DateTimeFormat>();

/** "14:30" or "2:30 PM" for a wall time from `wallTime`. */
export function formatClock(wall: number, locale: string, h12: boolean): string {
  const key = `${locale}|${h12}`;
  let f = clocks.get(key);
  if (!f) {
    // hourCycle, not hour12: false, which some engines turn into 24:30 for half past midnight.
    f = new Intl.DateTimeFormat(locale, { timeZone: "UTC", hour: h12 ? "numeric" : "2-digit", minute: "2-digit", hourCycle: h12 ? "h12" : "h23" });
    clocks.set(key, f);
  }
  return f.format(wall);
}

/** All zones the engine lists, plus UTC, which some engines leave out. */
export function allZones(): string[] {
  let list: string[] = [];
  try {
    list = Intl.supportedValuesOf("timeZone");
  } catch {
    // An engine without the list: the picker then has nothing to offer but UTC.
  }
  return list.includes("UTC") ? list : [...list, "UTC"];
}

/** Zones whose city, region or full name contains the text; the ones whose city starts with it come first. */
export function searchZones(query: string, zones: string[], limit = 40): string[] {
  const q = query.trim().toLowerCase().replaceAll("_", " ");
  if (!q) return [];
  const hits: { zone: string; rank: number }[] = [];
  for (const zone of zones) {
    const city = cityName(zone).toLowerCase();
    const full = zone.toLowerCase().replaceAll("_", " ");
    if (city.startsWith(q)) hits.push({ zone, rank: 0 });
    else if (city.includes(q) || full.includes(q)) hits.push({ zone, rank: 1 });
  }
  return hits.sort((a, b) => a.rank - b.rank || cityName(a.zone).localeCompare(cityName(b.zone))).slice(0, limit).map((h) => h.zone);
}

/** What a saved list may hold: known zone names, once each, at most MAX_ZONES. Anything else is dropped. */
export function normalizeZones(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const z of raw) if (isZone(z) && !out.includes(z)) out.push(z);
  return out.slice(0, MAX_ZONES);
}

/** The list with one zone moved a place up (-1) or down (1); unchanged at the ends. */
export function moveZone(list: string[], zone: string, by: -1 | 1): string[] {
  const i = list.indexOf(zone);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
