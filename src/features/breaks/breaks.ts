// Break reminders: a state machine over the time spent at the computer. Pure, the clock comes in as `now`.
//
// Work adds up while the user is at the machine. Every `microEveryMin` an eye break shows for MICRO_SEC (20-20-20: every
// 20 minutes, look 20 feet away for 20 seconds); every `longEveryMin` a long break of `longMin` minutes takes its place.
// No input for IDLE_BREAK_SEC counts as a break taken, and so does a computer that slept: everything starts over.

export type BreakKind = "micro" | "long";

export interface BreaksConfig {
  /** Off by default; nothing runs while it is. */
  on: boolean;
  /** Minutes of work between eye breaks. */
  microEveryMin: number;
  /** Minutes of work between long breaks. */
  longEveryMin: number;
  /** Minutes a long break lasts. */
  longMin: number;
}

export const BREAKS_DEFAULTS: BreaksConfig = { on: false, microEveryMin: 20, longEveryMin: 60, longMin: 5 };
export const LIMITS = { micro: [5, 60], long: [15, 240], longLength: [1, 30] } as const;

/** How long an eye break lasts. */
export const MICRO_SEC = 20;
/** Snooze brings the break back after this. */
export const SNOOZE_MIN = 5;
/** No keyboard or mouse input for this long counts as a break already taken. */
export const IDLE_BREAK_SEC = 300;
/** More than this between two ticks and the computer slept (or the page was frozen): a break, nothing is added up. */
export const SLEEP_GAP_MS = 120_000;

const clampInt = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : fallback;

/** A saved config (or nothing) → a valid one. */
export function normalizeBreaks(saved: unknown): BreaksConfig {
  const s = (typeof saved === "object" && saved !== null ? saved : {}) as Record<string, unknown>, d = BREAKS_DEFAULTS;
  return {
    on: typeof s.on === "boolean" ? s.on : d.on,
    microEveryMin: clampInt(s.microEveryMin, LIMITS.micro, d.microEveryMin),
    longEveryMin: clampInt(s.longEveryMin, LIMITS.long, d.longEveryMin),
    longMin: clampInt(s.longMin, LIMITS.longLength, d.longMin),
  };
}

export interface ShownBreak {
  kind: BreakKind;
  startedAt: number;
  endsAt: number;
  /** Counts the long breaks started: picks the suggestion, in turn. */
  tip: number;
}

export interface BreakState {
  /** The last tick (clock ms); null before the first. */
  last: number | null;
  /** Work since the last break of any kind, and since the last long one, in ms. */
  sinceBreak: number;
  sinceLong: number;
  /** The break on screen. */
  shown: ShownBreak | null;
  /** A break put off: nothing shows before `until`. */
  snoozed: { until: number } | null;
  /** Long breaks started so far. */
  longs: number;
}

export const fresh = (longs = 0): BreakState => ({ last: null, sinceBreak: 0, sinceLong: 0, shown: null, snoozed: null, longs });

/** The break on screen is over, by itself or skipped: the counters it covers start again. An eye break leaves the long one running. */
function done(s: BreakState): BreakState {
  return { ...s, shown: null, snoozed: null, sinceBreak: 0, sinceLong: s.shown?.kind === "long" ? 0 : s.sinceLong };
}

/**
 * One tick: adds the time since the last one to the work counters, ends a break whose time is up, and starts over when the user
 * was away. `idleSec` is the time since the last input, null when it is unknown (a tick that did not ask). Starts no break: see `start`.
 */
export function advance(s: BreakState, now: number, idleSec: number | null, cfg: BreaksConfig): BreakState {
  if (!cfg.on) return fresh(s.longs);
  const gap = s.last === null ? 0 : now - s.last;
  // Slept or away: that was a break. Nothing is added, and the reminders that piled up do not all come at once.
  if (gap > SLEEP_GAP_MS || (idleSec !== null && idleSec >= IDLE_BREAK_SEC)) return { ...fresh(s.longs), last: now };
  const next = { ...s, last: now };
  if (next.shown) return now >= next.shown.endsAt ? done(next) : next;
  // A clock set back gives a negative gap: nothing is added.
  const worked = Math.max(0, gap);
  return { ...next, sinceBreak: next.sinceBreak + worked, sinceLong: next.sinceLong + worked };
}

/** Which break is due by the work counters (the long one first), ignoring everything that can hold it back. */
export function dueKind(s: BreakState, cfg: BreaksConfig): BreakKind | null {
  if (!cfg.on) return null;
  if (s.sinceLong >= cfg.longEveryMin * 60_000) return "long";
  return s.sinceBreak >= cfg.microEveryMin * 60_000 ? "micro" : null;
}

/** A break is due, none is showing and it is not snoozed: it would start if nothing else holds it back. */
export function canStart(s: BreakState, now: number, cfg: BreaksConfig): boolean {
  return dueKind(s, cfg) !== null && !s.shown && !(s.snoozed && now < s.snoozed.until);
}

/** Starts the due break unless something holds it back (`blocked`: presentation, full screen, Do Not Disturb, quiet hours). One at a time, whatever piled up. */
export function start(s: BreakState, now: number, cfg: BreaksConfig, blocked: boolean): BreakState {
  const kind = dueKind(s, cfg);
  if (!kind || blocked || !canStart(s, now, cfg)) return s;
  const length = kind === "micro" ? MICRO_SEC * 1000 : cfg.longMin * 60_000;
  return { ...s, snoozed: null, shown: { kind, startedAt: now, endsAt: now + length, tip: s.longs }, longs: kind === "long" ? s.longs + 1 : s.longs };
}

/** Skip: counts as taken. */
export const skip = (s: BreakState): BreakState => (s.shown ? done(s) : s);

/** Snooze: the break goes away and comes back after SNOOZE_MIN; the work keeps adding up meanwhile. */
export const snooze = (s: BreakState, now: number): BreakState => (s.shown ? { ...s, shown: null, snoozed: { until: now + SNOOZE_MIN * 60_000 } } : s);

/** Something now holds the break back (a presentation began): it goes off the screen but stays due, and shows when that ends. */
export const suspend = (s: BreakState): BreakState => (s.shown ? { ...s, shown: null } : s);

/** Whole seconds left, rounded up so the card never shows 0:00 while it still runs. */
export const secondsLeft = (endsAt: number, now: number) => Math.max(0, Math.ceil((endsAt - now) / 1000));

/** "0:20", "5:00", "12:05". */
export const formatLeft = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
