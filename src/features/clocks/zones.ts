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

/**
 * Capitals and big cities that have no zone of their own name, each with the zones that keep their time, the current name first
 * and an older one an engine may list instead (Asia/Calcutta for Asia/Kolkata). Searched like a city; the clock added is the zone's.
 */
const ALIASES: readonly { name: string; zones: readonly string[] }[] = [
  { name: "Brasília", zones: ["America/Sao_Paulo"] },
  { name: "Rio de Janeiro", zones: ["America/Sao_Paulo"] },
  { name: "Washington", zones: ["America/New_York"] },
  { name: "Boston", zones: ["America/New_York"] },
  { name: "Miami", zones: ["America/New_York"] },
  { name: "Atlanta", zones: ["America/New_York"] },
  { name: "Ottawa", zones: ["America/Toronto"] },
  { name: "Houston", zones: ["America/Chicago"] },
  { name: "Dallas", zones: ["America/Chicago"] },
  { name: "Austin", zones: ["America/Chicago"] },
  { name: "San Francisco", zones: ["America/Los_Angeles"] },
  { name: "Seattle", zones: ["America/Los_Angeles"] },
  { name: "Las Vegas", zones: ["America/Los_Angeles"] },
  { name: "Quito", zones: ["America/Guayaquil"] },
  { name: "New Delhi", zones: ["Asia/Kolkata", "Asia/Calcutta"] },
  { name: "Delhi", zones: ["Asia/Kolkata", "Asia/Calcutta"] },
  { name: "Mumbai", zones: ["Asia/Kolkata", "Asia/Calcutta"] },
  { name: "Bengaluru", zones: ["Asia/Kolkata", "Asia/Calcutta"] },
  { name: "Chennai", zones: ["Asia/Kolkata", "Asia/Calcutta"] },
  { name: "Hyderabad", zones: ["Asia/Kolkata", "Asia/Calcutta"] },
  { name: "Islamabad", zones: ["Asia/Karachi"] },
  { name: "Beijing", zones: ["Asia/Shanghai"] },
  { name: "Shenzhen", zones: ["Asia/Shanghai"] },
  { name: "Guangzhou", zones: ["Asia/Shanghai"] },
  { name: "Osaka", zones: ["Asia/Tokyo"] },
  { name: "Kyoto", zones: ["Asia/Tokyo"] },
  { name: "Busan", zones: ["Asia/Seoul"] },
  { name: "Hanoi", zones: ["Asia/Ho_Chi_Minh", "Asia/Saigon"] },
  { name: "Abu Dhabi", zones: ["Asia/Dubai"] },
  { name: "Tel Aviv", zones: ["Asia/Jerusalem"] },
  { name: "Ankara", zones: ["Europe/Istanbul"] },
  { name: "Canberra", zones: ["Australia/Sydney"] },
  { name: "Wellington", zones: ["Pacific/Auckland"] },
  { name: "Abuja", zones: ["Africa/Lagos"] },
  { name: "Cape Town", zones: ["Africa/Johannesburg"] },
  { name: "Pretoria", zones: ["Africa/Johannesburg"] },
  { name: "Milano", zones: ["Europe/Rome"] },
  { name: "Milan", zones: ["Europe/Rome"] },
  { name: "Naples", zones: ["Europe/Rome"] },
  { name: "Florence", zones: ["Europe/Rome"] },
  { name: "Munich", zones: ["Europe/Berlin"] },
  { name: "Frankfurt", zones: ["Europe/Berlin"] },
  { name: "Hamburg", zones: ["Europe/Berlin"] },
  { name: "Barcelona", zones: ["Europe/Madrid"] },
  { name: "Manchester", zones: ["Europe/London"] },
  { name: "Edinburgh", zones: ["Europe/London"] },
  { name: "Geneva", zones: ["Europe/Zurich"] },
  { name: "Bern", zones: ["Europe/Zurich"] },
  { name: "Saint Petersburg", zones: ["Europe/Moscow"] },
];

/** For matching: no accents, no case, "_" read as a space, one space between words. */
const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replaceAll("_", " ").replace(/\s+/g, " ").trim();

/**
 * Zones whose city, region or full name contains the text, accents or not, and the zones of the capitals and cities it names
 * (ALIASES), each once with the name it is shown by: the city's own when that matches as well, else the alias. The ones whose
 * name starts with the text come first, then by name.
 */
export function searchHits(query: string, zones: string[], limit = 40): { zone: string; name: string }[] {
  const q = fold(query);
  if (!q) return [];
  const best = new Map<string, { rank: number; name: string }>();
  const hit = (zone: string, rank: number, name: string) => {
    const was = best.get(zone);
    if (!was || rank < was.rank) best.set(zone, { rank, name });
  };
  for (const zone of zones) {
    const city = fold(cityName(zone));
    if (city.startsWith(q)) hit(zone, 0, cityName(zone));
    else if (city.includes(q) || fold(zone).includes(q)) hit(zone, 1, cityName(zone));
  }
  for (const alias of ALIASES) {
    const name = fold(alias.name);
    const rank = name.startsWith(q) ? 0 : name.includes(q) ? 1 : -1;
    const zone = rank < 0 ? undefined : alias.zones.find((z) => zones.includes(z));
    if (zone) hit(zone, rank, alias.name);
  }
  return [...best]
    .sort(([, a], [, b]) => a.rank - b.rank || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(([zone, { name }]) => ({ zone, name }));
}

/** The zones of `searchHits`, in its order. */
export const searchZones = (query: string, zones: string[], limit = 40): string[] => searchHits(query, zones, limit).map((h) => h.zone);

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
