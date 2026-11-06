/** The last forecast fetched, kept on disk for when Open-Meteo doesn't answer. */
export interface SavedForecast<T> {
  key: string;
  at: number;
  data: T;
}

/** Older than this the current conditions say too little: the view shows its error instead. */
export const SAVED_FOR_MS = 24 * 60 * 60_000;

/** A saved forecast older than this no longer passes for the weather now in the closed row and the overview. */
export const STALE_AFTER_MS = 2 * 60 * 60_000;

/** Whether a forecast (with `savedAt` when it came from disk) is too old to show as the current weather. */
export const isStale = (savedAt: number | undefined, now: number) => savedAt !== undefined && now - savedAt > STALE_AFTER_MS;

/**
 * The saved forecast for this place, marked with when it was fetched and without the days already past
 * (`today` as YYYY-MM-DD); null when there is none, it is for another place, or it is too old.
 */
export function savedForecast<T extends { daily: { date: string }[] }>(
  saved: SavedForecast<T> | null,
  key: string,
  now: number,
  today: string,
): (T & { savedAt: number }) | null {
  if (!saved || saved.key !== key || now - saved.at > SAVED_FOR_MS) return null;
  return { ...saved.data, daily: saved.data.daily.filter((d) => d.date >= today), savedAt: saved.at };
}
