// Settings model of the closed notch's row: which parts show and in what order. Pure, so the saved shape can be repaired (and tested) without the app around it.

export const PART_IDS = ["timer", "discord", "rings", "title", "readings", "equalizer", "clock", "github", "leetcode", "calendar", "script", "downloads", "weather", "disk", "processes", "battery", "mic", "stopwatch", "todo", "note", "progress", "date", "world", "currency", "crypto"] as const;
export type PartId = (typeof PART_IDS)[number];
/** Widgets of Crest's bar alone: the closed row draws nothing for them, and its settings do not list them. */
export const BAR_ONLY: readonly PartId[] = ["disk", "processes", "battery", "mic", "stopwatch", "todo", "note", "progress", "date", "world", "currency", "crypto"];
/** Readings of the closed row; net, power, battery and temp are opt-in. */
export const READING_KEYS = ["cpu", "ram", "gpu", "net", "power", "battery", "temp"] as const;
export type ReadingKey = (typeof READING_KEYS)[number];
/** The pets the nest beside the notch can show (src/notch/pet/art.ts draws them). */
export const PET_IDS = ["cat", "cocker", "monkey", "sloth", "samurai", "robot", "flame", "zombie"] as const;
export type PetId = (typeof PET_IDS)[number];
/** The nest: which pet (null: none), its size in CSS px, independent of the notch's, and the side of the notch it sits on. */
export interface PetSettings { id: PetId | null; size: number; side: "left" | "right" }
export const PET_SIZE = { min: 32, max: 96, default: 48 } as const;
/** The nest stands this far from the shape's side: past the hit zone's padding (16), so the pointer on the pet never counts as on the notch. */
export const NEST_GAP = 20;
/** A click makes the pet this much bigger, until the pointer leaves it. */
export const NEST_ZOOM = 1.5;
export interface ClosedSettings { order: PartId[]; parts: Record<PartId, boolean>; readings: Record<ReadingKey, boolean>; clockSeconds: boolean; clockDate: boolean; lineProgress: boolean; quotaAlerts: boolean; downloadAlerts: boolean; statusAlerts: StatusAlerts; pet: PetSettings }
/**
 * `hideOsd` is not an alert: it hides the Windows volume and brightness indicator while Crest shows its own (status.ts osdHidden).
 * `everywhere` neither: the indicators (volume, brightness, the lock keys, the microphone, a copy) show over fullscreen apps and while Crest is hidden too.
 * `saver` covers Energy saver and the power mode, `power` the charger, the low battery and a battery charged on the charger.
 */
export interface StatusAlerts {
  power: boolean; saver: boolean; net: boolean; airplane: boolean; bt: boolean; output: boolean; display: boolean; volume: boolean; brightness: boolean;
  lock: boolean; insert: boolean; mic: boolean; focus: boolean; clip: boolean; hideOsd: boolean; everywhere: boolean;
}

export const CLOSED_DEFAULTS: ClosedSettings = {
  order: [...PART_IDS],
  parts: { timer: true, discord: true, rings: true, title: false, readings: false, equalizer: true, clock: false, github: false, leetcode: false, calendar: false, script: false, downloads: true, weather: false, disk: false, processes: false, battery: false, mic: false, stopwatch: false, todo: false, note: false, progress: false, date: false, world: false, currency: false, crypto: false },
  readings: { cpu: true, ram: true, gpu: true, net: false, power: false, battery: false, temp: false },
  clockSeconds: false, clockDate: false, lineProgress: true, quotaAlerts: true, downloadAlerts: true,
  statusAlerts: {
    power: true, saver: true, net: true, airplane: true, bt: true, output: true, display: true, volume: true, brightness: true,
    lock: true, insert: false, mic: true, focus: true, clip: false, hideOsd: false, everywhere: false,
  },
  pet: { id: null, size: PET_SIZE.default, side: "right" },
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Whatever was saved (0.1 had no `closed` at all) becomes a valid value: valid fields kept, unknown ids dropped, missing parts appended in default order. */
export function normalizeClosed(saved: unknown): ClosedSettings {
  const s = isObj(saved) ? saved : {}, d = CLOSED_DEFAULTS;
  const order = (Array.isArray(s.order) ? s.order : []).filter((id, i, all): id is PartId => PART_IDS.includes(id as PartId) && all.indexOf(id) === i);
  for (const id of PART_IDS) if (!order.includes(id)) order.push(id);
  const parts = isObj(s.parts) ? s.parts : {}, readings = isObj(s.readings) ? s.readings : {}, alerts = isObj(s.statusAlerts) ? s.statusAlerts : {};
  return {
    order,
    parts: Object.fromEntries(PART_IDS.map((id) => [id, bool(parts[id], d.parts[id])])) as Record<PartId, boolean>,
    readings: Object.fromEntries(READING_KEYS.map((k) => [k, bool(readings[k], d.readings[k])])) as Record<ReadingKey, boolean>,
    clockSeconds: bool(s.clockSeconds, d.clockSeconds), clockDate: bool(s.clockDate, d.clockDate), lineProgress: bool(s.lineProgress, d.lineProgress), quotaAlerts: bool(s.quotaAlerts, d.quotaAlerts),
    downloadAlerts: bool(s.downloadAlerts, d.downloadAlerts),
    statusAlerts: Object.fromEntries(Object.entries(d.statusAlerts).map(([k, v]) => [k, bool(alerts[k], v)])) as unknown as StatusAlerts,
    pet: normalizePet(s.pet),
  };
}

/** A saved pet setting as a valid one: an unknown pet is none, the size kept within PET_SIZE, the side left or right. */
export function normalizePet(saved: unknown): PetSettings {
  const p = isObj(saved) ? saved : {}, d = CLOSED_DEFAULTS.pet;
  const size = typeof p.size === "number" && Number.isFinite(p.size) ? Math.round(Math.min(PET_SIZE.max, Math.max(PET_SIZE.min, p.size))) : d.size;
  return { id: PET_IDS.includes(p.id as PetId) ? (p.id as PetId) : null, size, side: p.side === "left" ? "left" : "right" };
}

/** "title · artist"; with only one of them, just that one. */
export const trackCaption = (title: string, artist: string) => [title.trim(), artist.trim()].filter(Boolean).join(" · ");

/**
 * The tool a part of the closed row opens, with a click or with the hover that opens the notch over it: the cover, the title,
 * a lyric line and the equalizer open the music, the timer and the clock the timer, and so on. null: the notch opens as usual.
 */
export function partTool(part: string): string | null {
  switch (part) {
    case "cover":
    case "lyric":
    case "title":
    case "equalizer":
      return "media";
    case "timer":
    case "clock":
      return "timer";
    case "rings":
      return "usage";
    case "readings":
      return "system";
    case "script":
      return "notices";
    case "awake":
      return "overview";
    case "downloads":
      return "shelf";
    case "weather":
      return "weather";
    case "discord":
    case "github":
    case "leetcode":
    case "calendar":
      return part;
    default:
      return null;
  }
}
