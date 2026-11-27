/*
 * The anonymous daily count behind crestisland.app/stats: at most one ping per UTC day per install, with this build's version,
 * platform and channel only (src-tauri count.rs). Started with the update check (update.ts).
 */

/** The UTC date, "2026-11-27". */
export const utcDay = (now: Date) => now.toISOString().slice(0, 10);

/**
 * One check: sends while `on` and only on a UTC day later than `last`, the last one counted (a clock set back sends nothing).
 * Returns the day to keep: today once the ping was counted, else `last`, so a failure tries again at the next check.
 */
export async function countCheck(on: boolean, last: string | null, now: Date, send: () => Promise<boolean>): Promise<string | null> {
  const today = utcDay(now);
  if (!on || (last !== null && last >= today)) return last;
  return (await send().catch(() => false)) ? today : last;
}
