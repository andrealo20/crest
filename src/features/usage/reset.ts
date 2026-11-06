// A quota window that has reset: it stood high at the last reading and its reset time has come. Pure, like the 70 and 90 % rule in notch/row/notices.ts.
import type { UsageProvider } from "../../platform/services";
import { QUOTA, type QuotaRise } from "../../notch/row/notices.ts";
import { inQuiet } from "../notices/rules.ts";

/** The reading before must be this recent: after a longer gap (sleep, polling off) nobody knows when the reset came, and it is no news. */
export const MAX_GAP_MS = 10 * 60_000;
/** A reading may come this early against the reset time: the provider's clock and ours differ. */
export const SKEW_MS = 2 * 60_000;

/** What the last reading said of one window. */
export interface WindowSeen {
  used: number;
  resetsAt: number | null;
  at: number;
}
export type ResetTracker = Map<string, WindowSeen>;
export const newResetTracker = (): ResetTracker => new Map();

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * `used` is the new reading, null when the window is no longer in the answer. A window counts as reset when it stood at the
 * warning level or above and now is at most half of that, and its reset time has passed (or was never known). A window that
 * dropped out of the answer needs the passed reset time: an idle window may be left out once it has reset.
 */
function rolledOver(prev: WindowSeen, used: number | null, now: number): boolean {
  if (prev.used < QUOTA.warning || now - prev.at > MAX_GAP_MS) return false;
  const passed = prev.resetsAt !== null && now >= prev.resetsAt - SKEW_MS;
  if (used === null) return passed;
  return used <= prev.used / 2 && (prev.resetsAt === null || passed);
}

/**
 * Remembers every window of an answer and returns the one that reset since the answer before, the one that stood highest if
 * several did (`used` and `resetsAt` are of the new window). The first answer only records, so opening the app after a reset
 * says nothing. Cards kept from an old reading (an error) are skipped and leave the record as it was.
 */
export function detectReset(tracker: ResetTracker, providers: UsageProvider[], now: number): QuotaRise | null {
  const hits: { rise: QuotaRise; was: number }[] = [];
  const found = (rise: QuotaRise, was: number) => hits.push({ rise, was });
  for (const p of providers) {
    if (p.error || !p.windows?.length) continue;
    const present = new Set<string>();
    for (const w of p.windows) {
      const key = `${p.id}:${w.kind}`;
      present.add(key);
      if (!finite(w.usedPercent)) continue;
      const prev = tracker.get(key), resetsAt = finite(w.resetsAt) ? w.resetsAt : null;
      tracker.set(key, { used: w.usedPercent, resetsAt, at: now });
      if (prev && rolledOver(prev, w.usedPercent, now)) found({ provider: p.id, kind: w.kind, used: w.usedPercent, resetsAt, reset: true }, prev.used);
    }
    for (const [key, prev] of tracker) {
      if (!key.startsWith(`${p.id}:`) || present.has(key)) continue;
      tracker.delete(key);
      if (rolledOver(prev, null, now)) found({ provider: p.id, kind: key.slice(p.id.length + 1), used: 0, resetsAt: null, reset: true }, prev.used);
    }
  }
  // The sort is stable: of equals, the first.
  return hits.sort((a, b) => b.was - a.was)[0]?.rise ?? null;
}

/** Whether a reset may be announced: the switch is on, and presentation mode and the notices' quiet hours stay quiet (as for a finished download). */
export function resetAlertAllowed(on: boolean, presenting: boolean, quiet: { on: boolean; from: string; to: string }, at: Date): boolean {
  return on && !presenting && !(quiet.on && inQuiet(at.getHours() * 60 + at.getMinutes(), quiet.from, quiet.to));
}
