// How much of the day, the month or the year has gone, for the bar's Time progress. Pure: every function takes the time.

export type Span = "day" | "month" | "year";

const DAY_S = 86_400, DAY_MS = 86_400_000;

/**
 * The share of `span` gone at `ms`, 0 to just under 1, by the wall clock: a day the clocks change still counts 24 hours, so noon is
 * always half of it and the bar never jumps an hour at night.
 */
export function shareOf(ms: number, span: Span): number {
  const d = new Date(ms), y = d.getFullYear(), m = d.getMonth();
  const day = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / DAY_S;
  if (span === "day") return day;
  if (span === "month") return (d.getDate() - 1 + day) / new Date(y, m + 1, 0).getDate();
  // Whole days counted in UTC, which has no clock changes.
  return ((Date.UTC(y, m, d.getDate()) - Date.UTC(y, 0, 1)) / DAY_MS + day) / ((Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / DAY_MS);
}

/** The percent rounded down; the nudge keeps a share like 0.29, which floats as 28.999..., on its own figure. */
export const percentOf = (share: number): number => Math.floor(share * 100 + 1e-9);
