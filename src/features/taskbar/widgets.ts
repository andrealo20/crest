// The closed notch's parts as widgets of Crest's bar, and the buttons that open a tool: which items are widgets, what a click on one
// opens, their size, and adding or removing one. Pure, so the rules are tested without the app around them.

import { PART_IDS, partTool, type PartId } from "../../notch/row/parts.ts";
import { SYS_IDS, TASKBAR_DEFAULTS, TOOL_BUTTONS, WIDGET_VARIANTS, fitIcon, isObj, variantOf, type BarItem, type SysId, type SysItem, type TaskbarSettings, type ToolItem, type WidgetVariants, type Zone } from "./model.ts";
import { opensInBar } from "./panelModel.ts";
import type { BarLook } from "./look.ts";
import type { PrivacyState } from "../../platform/services.ts";

/** What the settings take off the bar and put back like a widget: the widgets, the tray, Stato, the Crest button, the tool buttons and Windows' buttons. */
export type Removable = PartId | "tray" | "status" | "crest" | ToolItem | SysItem;

export const isWidget = (id: string): id is PartId => PART_IDS.includes(id as PartId);
export const isTool = (id: string): id is ToolItem => id.startsWith("tool:");
/** A tool button's tool. */
export const toolOf = (id: ToolItem): string => id.slice("tool:".length);
const SYS_ITEMS: readonly string[] = SYS_IDS.map((id) => `sys:${id}`);
/** One of Windows' buttons the bar knows; another window may send a raw `sys:` id it does not (storeCore.ts:51-57). */
export const isSys = (id: string): id is SysItem => SYS_ITEMS.includes(id);
/** A Windows button's id. */
export const sysOf = (id: SysItem): SysId => id.slice("sys:".length) as SysId;
/**
 * What the trash takes while it is dragged along the bar (ItemDrop): the widgets, the tool buttons, Windows' buttons, Stato and the
 * Crest button (a right click on the bar still opens its menu), as Remove in Settings does. Never the tray, whose icons would all be
 * out of reach, nor Start or the apps.
 */
export const trashable = (id: string): id is Removable => isWidget(id) || isTool(id) || isSys(id) || id === "status" || id === "crest";
/** Whether a Windows button shows on the primary bar only: Windows widgets, the input language, the privacy indicators and the Recycle Bin, which Windows keeps on the main taskbar; the others are on every bar. */
export const sysPrimaryOnly = (id: SysItem): boolean => sysOf(id) !== "search" && sysOf(id) !== "taskview" && sysOf(id) !== "desktop";
/** Whether the notch polls the privacy state for the bar: on, with its privacy button on it. */
export const privacyOnBar = (t: TaskbarSettings): boolean => t.enabled && Object.values(t.zones).some((items) => items.includes("sys:privacy"));
/** What the privacy button shows, in Windows' order. */
export const privacyParts = (p: PrivacyState): ("mic" | "camera" | "location")[] => (["mic", "camera", "location"] as const).filter((k) => p[k]);
/** What Add Windows button offers, in SYS_IDS' order: the buttons not on the bar. */
export const addableSys = (zones: Record<Zone, BarItem[]>): SysItem[] =>
  SYS_IDS.map((id): SysItem => `sys:${id}`).filter((id) => !Object.values(zones).some((items) => items.includes(id)));
/** A tool switched on or off in the notch's settings (settings.tools). */
export type ToolSwitch = { id: string; enabled: boolean };

/**
 * The ink a widget's preview on the Widgets page wears, as the bar's own (useBarSurface in window/BarGlass.tsx): Dark's (`dark`)
 * under Liquid Glass + whatever the surface, the closed notch's (`closed`) on the Notch surface, the theme's (undefined) otherwise.
 */
// shortcut: a copy of useBarSurface's ink line, BarGlass.tsx being Material's; one helper for both once the contract lets it move.
export function previewInk(look: BarLook, surface: TaskbarSettings["surface"], closed: Record<string, string> | undefined, dark: Record<string, string>): Record<string, string> | undefined {
  return look === "plus" ? { ...dark, "--accent": dark["--theme-accent"] } : surface === "notch" ? closed : undefined;
}

/**
 * The tool a widget opens in the panel over the bar; null for the clock, which opens Crest's Notices and Calendar on the main bar and
 * Windows' notification centre on the others, and the disk widget, whose panels are the bar's own.
 */
export const widgetTool = (id: PartId): string | null => (id === "clock" ? null : partTool(id));

/** A widget's size against the notch's: 1 with the default icons, growing and shrinking with the icons the bar draws. */
export const widgetScale = (height: number, iconSize: number): number => fitIcon(height, iconSize) / TASKBAR_DEFAULTS.iconSize;

/**
 * Whether a widget sits on Stato's pill: weather and hardware, which Andrea named, off Tiles, whose tile is already one. Windows 11's
 * clock has no pill, and a long title in one would change the bar more than asked.
 */
export const pillWidget = (id: PartId, tiles: boolean): boolean => !tiles && (id === "weather" || id === "readings");

/**
 * A widget button's width for a body `width` wide at scale `k`: even, so a centred zone stays on whole pixels, plus the 8 px a bar
 * button keeps on each side, or in the pill (`pad`, statusPill) the pill's own sides, as the pill is the whole button, as Stato's.
 */
export const widgetWidth = (width: number, k: number, pad: number | null): number => Math.round((width * k) / 2) * 2 + (pad === null ? 16 : 2 * pad);

/** The widgets on the bar, reading left, center, right. */
export const barWidgets = (zones: Record<Zone, BarItem[]>): PartId[] => [...zones.left, ...zones.center, ...zones.right].filter(isWidget);

/**
 * Whether a button of `tool` shows on the bar and in Add tool: one the notch opens only while the tool is on there, since the notch
 * opens its first tool in place of one switched off (Notch.tsx:105-108); one the panel opens, and Find on screen, a page without a
 * switch, always. Never one the bar does not offer: another window gets the settings' raw JSON from a storage event, without
 * normalizeZones (storeCore.ts:51-57).
 */
export const toolShown = (tool: string, tools: readonly ToolSwitch[]): boolean =>
  TOOL_BUTTONS.includes(tool) && (opensInBar({ kind: "tool", tool }) || tool === "find" || tools.some((x) => x.id === tool && x.enabled));

/** The zones the bar draws and fits: without the buttons whose tool cannot open (toolShown). */
export function shownZones(zones: Record<Zone, BarItem[]>, tools: readonly ToolSwitch[]): Record<Zone, BarItem[]> {
  const keep = (id: BarItem) => !isTool(id) || toolShown(toolOf(id), tools);
  return { left: zones.left.filter(keep), center: zones.center.filter(keep), right: zones.right.filter(keep) };
}

/** What Add tool offers, in the notch's order: the tools a button can open (TOOL_BUTTONS) not on the bar and able to open (toolShown). */
export const addableTools = (zones: Record<Zone, BarItem[]>, tools: readonly ToolSwitch[]): string[] =>
  TOOL_BUTTONS.filter((id) => !Object.values(zones).some((items) => items.includes(`tool:${id}`)) && toolShown(id, tools));

/**
 * The widgets the notch's stores run for the bar (barParts): all of them while the bar is on and its sources run (feed.tsx: it shows,
 * or it slid away less than SLIDE_KEEP_MS ago), none while it is off, and otherwise only Discord, which stays connected: each connect
 * is a login with a token refresh, and a failed one asks for consent again.
 */
export const barPartsFor = (widgets: PartId[], on: boolean, shown: boolean): PartId[] =>
  !on ? [] : shown ? widgets : widgets.filter((id) => id === "discord");

/**
 * The sources the notch runs for the bar (feed.tsx): those of `parts`, and the equalizer's, which keeps the audio capture on, while
 * a bar's panel shows Now Playing (`media`), whose equalizer only listens to the levels.
 */
export const barSources = (parts: readonly PartId[], media: boolean): readonly PartId[] => (media && !parts.includes("equalizer") ? [...parts, "equalizer"] : parts);

/** How long the notch keeps the bar's widget sources after the primary bar starts sliding away (auto-hide), ms: back within it, the bar finds them running. */
export const SLIDE_KEEP_MS = 30_000;

/** What the notch hears of the primary bar (`bar://shown`, bar.rs `notch_hears`): its window shows (a full-screen app and the hide hotkey hide it), and its page slid it off the screen. */
export interface BarSeen {
  shown: boolean;
  slid: boolean;
}

/**
 * The widgets' sources once the primary bar goes from `before` to `now`: running while it shows and is up; kept for SLIDE_KEEP_MS when
 * it starts sliding away from up ("keep"), then resting; resting at once when its window hides, and while it shows again still slid.
 * Null when nothing changed, so a repeated message neither stops them nor starts another wait.
 */
export function sourcesAfter(before: BarSeen, now: BarSeen): "run" | "keep" | "rest" | null {
  if (now.shown === before.shown && now.slid === before.slid) return null;
  if (!now.shown) return "rest";
  if (!now.slid) return "run";
  return before.shown && !before.slid ? "keep" : "rest";
}

/**
 * The zones with `id` (a widget or a tool button) last in `to`, before the Crest button when the zone ends with it, so the button
 * stays at the edge (the button itself, taken off, comes back there); one already on the bar leaves them as they are.
 */
export function addWidget(zones: Record<Zone, BarItem[]>, id: Removable, to: Zone): Record<Zone, BarItem[]> {
  if (Object.values(zones).some((items) => items.includes(id))) return zones;
  const items = zones[to], at = items.at(-1) === "crest" ? items.length - 1 : items.length;
  return { ...zones, [to]: [...items.slice(0, at), id, ...items.slice(at)] };
}

/** The zones without `id`, a widget or a tool button. */
export const removeWidget = (zones: Record<Zone, BarItem[]>, id: Removable): Record<Zone, BarItem[]> => ({
  left: zones.left.filter((x) => x !== id),
  center: zones.center.filter((x) => x !== id),
  right: zones.right.filter((x) => x !== id),
});

/** One version a widget offers on the Widgets page: its variant (null for a widget with only today's look), and for the digital clock its date. */
export type WidgetChoice = { variant: string | null; date?: boolean };

const hasVersions = (id: PartId): id is keyof WidgetVariants => Object.hasOwn(WIDGET_VARIANTS, id);

/**
 * The versions the Widgets page offers for `id`, today's first. The clock's "time and date" and "time only" are the digital clock with
 * taskbar.clock.date, its only source (design 3D); two zones only while the Clocks tool has a zone (`zones`).
 */
export function widgetChoices(id: PartId, zones: boolean): WidgetChoice[] {
  if (id === "clock") return [{ variant: "digital", date: true }, { variant: "digital", date: false }, { variant: "analog" }, ...(zones ? [{ variant: "zones" }] : [])];
  return hasVersions(id) ? WIDGET_VARIANTS[id].map((variant) => ({ variant })) : [{ variant: null }];
}

/** The index in widgetChoices of the version the bar draws: the saved one (through variantOf), the clock's digital ones by its date. */
export function chosenChoice(id: PartId, variants: unknown, date: boolean, zones: boolean): number {
  if (id === "clock") {
    const v = variantOf(variants, "clock");
    return v === "analog" ? 2 : v === "zones" && zones ? 3 : date ? 0 : 1;
  }
  return hasVersions(id) ? (WIDGET_VARIANTS[id] as readonly string[]).indexOf(variantOf(variants, id)) : 0;
}

/** Whether the clock the bar draws has seconds to switch: the digital one, also for Two time zones saved while no zone draws them. */
export const clockHasSeconds = (variants: unknown, zones: boolean): boolean => chosenChoice("clock", variants, true, zones) < 2;

/**
 * The settings patch for picking `c` for `id`: the version in variants, the digital clock's date in clock (and no clock in
 * variants), nothing for a widget without versions or when the saved settings already say so, compared with what is saved, not
 * with the version shown (Two time zones saved without a zone shows the digital clock). `cur.variants` may be raw JSON from
 * another window (storeCore.ts:51-57).
 */
export function applyChoice(cur: Pick<TaskbarSettings, "variants" | "clock">, id: PartId, c: WidgetChoice): Partial<TaskbarSettings> {
  const variants = (isObj(cur.variants) ? cur.variants : {}) as TaskbarSettings["variants"];
  if (!hasVersions(id) || c.variant === null) return {};
  const patch: Partial<TaskbarSettings> =
    id === "clock" && c.variant === "digital"
      ? { variants: (({ clock: _, ...rest }) => rest)(variants), clock: { ...cur.clock, date: c.date ?? cur.clock.date } }
      : { variants: { ...variants, [id]: c.variant } };
  const same = Object.entries(patch).every(([k, v]) => JSON.stringify(v) === JSON.stringify(cur[k as keyof typeof cur]));
  return same ? {} : patch;
}

/**
 * The version an arrow key moves to from `at` of `count`: Right and Down the next, Left and Up the previous (Left and Right swapped
 * right to left), wrapping; Home the first, End the last; undefined for any other key.
 */
// shortcut: local until material-style's src/ui/radioKeys.ts arrowStep lands with the merge, then use it.
export function variantKey(key: string, at: number, count: number, rtl: boolean): number | undefined {
  const step = key === "ArrowDown" || key === (rtl ? "ArrowLeft" : "ArrowRight") ? 1 : key === "ArrowUp" || key === (rtl ? "ArrowRight" : "ArrowLeft") ? -1 : 0;
  if (step) return (at + step + count) % count;
  return key === "Home" ? 0 : key === "End" ? count - 1 : undefined;
}
