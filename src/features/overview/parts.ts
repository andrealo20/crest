// Overview's parts (OverviewView.tsx), each behind a switch in Settings > Tools, To-dos and Overview (#76), and the height they take. Pure.
// The quote and the web search line keep their own settings (productivity.quotes, productivity.search).

export const OVERVIEW_PARTS = ["clock", "weather", "activity", "focus", "awake", "volume", "brightness", "controls"] as const;
export type OverviewPart = (typeof OVERVIEW_PARTS)[number];
export type OverviewParts = Record<OverviewPart, boolean>;

export const OVERVIEW_PARTS_DEFAULT: OverviewParts = { clock: true, weather: true, activity: true, focus: true, awake: true, volume: true, brightness: true, controls: true };

/** The row of tiles, which a Mac does not show (no backend there yet). */
export const TILES = ["focus", "awake", "volume"] as const satisfies readonly OverviewPart[];

/** The parts that show whenever they are on, so one of them can keep Overview alone; brightness and the quick controls can be missing. */
const steady = (mac: boolean): readonly OverviewPart[] => (mac ? ["clock", "weather", "activity"] : ["clock", "weather", "activity", ...TILES]);

/** Saved parts repaired: a boolean stays, anything else shows; a file with none of the steady parts on keeps the clock. */
export function normalizeOverviewParts(saved: unknown, mac: boolean): OverviewParts {
  const s = saved && typeof saved === "object" && !Array.isArray(saved) ? (saved as Record<string, unknown>) : {};
  const out = { ...OVERVIEW_PARTS_DEFAULT };
  for (const id of OVERVIEW_PARTS) if (typeof s[id] === "boolean") out[id] = s[id];
  return steady(mac).some((id) => out[id]) ? out : { ...out, clock: true };
}

/** One part switched; the same object when nothing changes, or when it would turn off the last steady part (its switch stays on). */
export function setOverviewPart(parts: OverviewParts, id: OverviewPart, on: boolean, mac: boolean): OverviewParts {
  if (parts[id] === on) return parts;
  if (!on && steady(mac).includes(id) && steady(mac).filter((k) => parts[k]).length === 1) return parts;
  return { ...parts, [id]: on };
}

/**
 * Overview's default height with these parts: 252 with all of them, each row hidden giving back its height and the 10 px gap above
 * the next. The header row is 54 px with the standard clock (34 px, mt-1 and a 16 px footnote line; another clock look is 58 px, 4 px
 * over as before) and 42 px with the weather alone (its 22 px row, mt-1 and the footnote). Brightness and the quick controls are added
 * by OverviewView while they show, as the output list is.
 */
export function overviewHeight(parts: OverviewParts): number {
  let h = 252;
  if (!parts.clock && !parts.weather) h -= 64;
  else if (!parts.clock) h -= 12;
  if (!parts.activity) h -= 54;
  if (!TILES.some((id) => parts[id])) h -= 50;
  return h;
}
