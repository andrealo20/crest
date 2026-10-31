// Partly translated from BrimDeck (Apache-2.0, github.com/MoFeng2223/BrimDeck), src/BrimDeck.Core/SystemMonitor.cs
// (ReadingLevels, MemorySample.Level). How loaded a reading is, and the colour each scheme gives that level.

/** 0 normal, 1 elevated, 2 critical. */
export type Level = 0 | 1 | 2;

/** A share in percent: elevated from 70, critical from 90 (Crest's thresholds since 0.1). */
export const ofShare = (percent: number): Level => (percent >= 90 ? 2 : percent >= 70 ? 1 : 0);

/**
 * A rate in bytes per second against fixed rates (10 and 50 MB/s). A share of the link speed would hardly ever rise:
 * Windows reports the nominal speed of the link (1 Gb/s on a line that delivers far less).
 */
export const ofRate = (bytesPerSecond: number): Level => (bytesPerSecond >= 50e6 ? 2 : bytesPerSecond >= 10e6 ? 1 : 0);

/**
 * Windows reports no memory pressure level as macOS does; it is read from the share of physical memory in use and the
 * commit charge (memory promised to processes) against its limit (physical memory plus page file).
 */
export function memoryLevel(used: number, total: number, commit: number, limit: number): Level {
  const u = total > 0 ? (used / total) * 100 : 0, c = limit > 0 ? commit / limit : 0;
  return u >= 90 || c >= 0.9 ? 2 : u >= 70 || c >= 0.8 ? 1 : 0;
}

export type ColorScheme = "calm" | "traffic" | "accent";
export const COLOR_SCHEMES: ColorScheme[] = ["calm", "traffic", "accent"];

const COLORS: Record<ColorScheme, [string, string, string]> = {
  // Monochrome until it gets high, as before: the eye only goes where something is wrong.
  calm: ["var(--color-label)", "var(--color-orange)", "var(--color-red)"],
  traffic: ["var(--color-green)", "var(--color-yellow)", "var(--color-red)"],
  accent: ["var(--color-accent)", "var(--color-orange)", "var(--color-red)"],
};

export const schemeColor = (scheme: ColorScheme, level: Level) => (COLORS[scheme] ?? COLORS.calm)[level];

/** The adapter to show: the chosen one by name, else the one with most dedicated memory ("" = automatic). */
export function pickGpu<T extends { name: string; memTotal: number }>(gpus: T[], choice: string): T | null {
  return gpus.find((g) => choice && g.name === choice) ?? gpus.reduce<T | null>((best, g) => (!best || g.memTotal > best.memTotal ? g : best), null);
}

/** Click on the GPU row: the next adapter after the one shown, round. */
export function nextGpu<T extends { name: string; memTotal: number }>(gpus: T[], choice: string): string {
  const shown = pickGpu(gpus, choice);
  if (!shown || gpus.length < 2) return choice;
  return gpus[(gpus.indexOf(shown) + 1) % gpus.length].name;
}
