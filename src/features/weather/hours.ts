/**
 * When a forecast hour starts. Open-Meteo gives the place's clock time ("2026-11-04T15:00") and its UTC offset in seconds;
 * without the offset (forecasts saved before it was kept) the time is read in the PC's zone.
 */
export function hourStart(time: string, offset?: number): number {
  return offset === undefined ? new Date(time).getTime() : Date.parse(`${time}Z`) - offset * 1000;
}

/** The hours after now, as the bar's face shows them: Open-Meteo's list starts at the hour of the fetch, and a saved forecast may be hours old. */
export function nextHours<H extends { time: string }>(hourly: H[] | undefined, offset: number | undefined, now: number, n = 3): H[] {
  return (hourly ?? []).filter((h) => hourStart(h.time, offset) > now).slice(0, n);
}

/**
 * The daylight the bar's sun face shows: today's or tomorrow's, the first whose sunset is still to come, and how far the sun is between
 * its sunrise and sunset (0 to 1), null while it has not risen. Null when neither has both, and in a midnight sun.
 */
export function sunNow(daily: { sunrise?: string; sunset?: string }[], offset: number | undefined, now: number): { rise: string; set: string; share: number | null } | null {
  for (const d of daily.slice(0, 2)) {
    // Polar night: the same 00:00 for both; midnight sun: 00:00 to the next day's 00:00.
    if (!d.sunrise || !d.sunset || d.sunrise === d.sunset) continue;
    const rise = hourStart(d.sunrise, offset), set = hourStart(d.sunset, offset);
    if (set > now) return set - rise >= 86_400_000 ? null : { rise: d.sunrise, set: d.sunset, share: now < rise ? null : (now - rise) / (set - rise) };
  }
  return null;
}
