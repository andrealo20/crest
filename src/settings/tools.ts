/** All tool IDs in default order. Must match `src/notch/tabs.ts`. */
export const TOOL_IDS = [
  "overview",
  "media",
  "timer",
  "todos",
  "notes",
  "clipboard",
  "shelf",
  "ask",
  "convert",
  "trading",
  "usage",
  "weather",
  "system",
  "discord",
  "vault",
  "water",
  "scratchpad",
  "terminal",
  "launcher",
  "github",
  "leetcode",
  "calendar",
  "notices",
  "capture",
  "recorder",
  "camera",
  "habits",
  "colour",
  "clocks",
  "teleprompter",
  "agents",
  "calc",
] as const;

/**
 * The tools with `id` switched off in its place, as its switch in Settings > Tools does, for a tool dropped on the trash over the
 * notch's tool bar (`shown`, the ids on it). The very same list, so nothing is written, for the last tool on the bar or one not on it.
 */
export function toolOff<T extends { id: string; enabled: boolean }>(tools: T[], id: string, shown: readonly string[]): T[] {
  if (shown.length <= 1 || !shown.includes(id)) return tools;
  return tools.map((x) => (x.id === id ? { ...x, enabled: false } : x));
}

/** The tools that start switched off on a fresh install. */
export const DEFAULT_OFF = new Set<string>(["system", "discord", "trading", "vault", "water", "scratchpad", "terminal", "github", "leetcode", "calendar", "notices", "recorder", "camera", "habits", "colour", "clocks", "teleprompter", "agents", "calc"]);
