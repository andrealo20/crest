// The finished focus rounds the Day timeline draws: kept 30 days, only while the timeline or Screen Time is in use (roundsWanted).

/** A finished focus round: when it ended (ms) and the length it was set to (s). Its start is the end less the length: pauses do not show. */
export type FocusRound = { end: number; secs: number };

const KEEP_MS = 30 * 86_400_000;
const MAX = 400;

/** The rounds that ended in the last 30 days. */
export const freshRounds = (list: FocusRound[], now: number): FocusRound[] => list.filter((r) => now - r.end <= KEEP_MS);

/** `round` added unless one ended at the same moment, the rounds older than 30 days dropped, the last 400 by their end kept. */
export function logRound(list: FocusRound[], round: FocusRound, now: number): FocusRound[] {
  const kept = freshRounds(list, now);
  const all = kept.some((r) => r.end === round.end) ? kept : [...kept, round];
  return all.sort((a, b) => a.end - b.end).slice(-MAX);
}

/** What another window or a backup saved, as a list of rounds: an end that is a number and a length from 5 s to a day, the rest dropped. */
export function roundsOf(saved: unknown): FocusRound[] {
  if (!Array.isArray(saved)) return [];
  return saved.flatMap((r) => {
    const { end, secs } = (r ?? {}) as Partial<Record<keyof FocusRound, unknown>>;
    return typeof end === "number" && Number.isFinite(end) && typeof secs === "number" && secs >= 5 && secs <= 86_400 ? [{ end, secs }] : [];
  });
}

/** Each round as its start and end (ms), those that touch the window from `from` to `to`. */
export function roundSpans(list: FocusRound[], from: number, to: number): [number, number][] {
  return list.map((r): [number, number] => [r.end - r.secs * 1000, r.end]).filter(([start, end]) => start < to && end > from);
}

/** The focus round running at `now`, from its start to `now`; none while paused, in a break or stopped. */
export const runningSpan = (t: { mode: string; endsAt: number | null; duration: number }, now: number): [number, number] | null =>
  t.mode === "focus" && t.endsAt !== null ? [t.endsAt - t.duration * 1000, Math.min(now, t.endsAt)] : null;

/**
 * Whether a finished round is written: while Screen Time records, or while the Day timeline is on in the closed row or in one of the
 * zones of Crest's bar, turned on (hidden for now, over a full-screen app, still counts). A round is no work hour kept without that
 * consent.
 */
export const roundsWanted = (s: {
  screenTime: { on: boolean };
  closed: { parts: { timeline?: boolean } };
  taskbar: { enabled: boolean; zones: Record<string, readonly string[]> };
}): boolean =>
  s.screenTime.on || s.closed.parts.timeline === true || (s.taskbar.enabled && Object.values(s.taskbar.zones).some((items) => items.includes("timeline")));
