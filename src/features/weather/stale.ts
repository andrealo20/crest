/** The last forecast fetched, kept on disk for when Open-Meteo doesn't answer. */
export interface SavedForecast<T> {
  key: string;
  at: number;
  data: T;
}

/** A forecast fetched less than this long ago is current: the notch shows it again from memory instead of asking Open-Meteo. */
export const FRESH_MS = 10 * 60_000;

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

/**
 * The saved forecast as a window that fetches none shows it (the bar's, from what the notch saves): as `savedForecast`, but one
 * fetched within FRESH_MS is the weather now, as the notch shows it then, so it carries no `savedAt`.
 */
export function shownForecast<T extends { daily: { date: string }[] }>(
  saved: SavedForecast<T> | null,
  key: string,
  now: number,
  today: string,
): (T & { savedAt?: number }) | null {
  const f = savedForecast(saved, key, now, today);
  return f && now - f.savedAt < FRESH_MS ? { ...f, savedAt: undefined } : f;
}
