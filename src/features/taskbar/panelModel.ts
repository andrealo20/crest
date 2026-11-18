// The rules of the panel above Crest's bar: what it shows, which tools open in it, how big it is, and where an icon dragged onto
// the bar lands. Pure, so they can be tested without the app around them.

import { DOCK_HEIGHT } from "../../notch/geometry.ts";

/** What the panel shows: a tool, by the id the notch opens it with, the tray's hidden icons, the apps behind "…", or Stato's quick panel. */
export type PanelContent = { kind: "tool"; tool: string } | { kind: "tray" } | { kind: "apps" } | { kind: "quick" };
/** The item the panel opens over: its left edge and its width, CSS px. */
export interface PanelAnchor {
  x: number;
  w: number;
}
/** The open panel: what it shows and the item it is centred on. */
export interface OpenPanel {
  content: PanelContent;
  anchor: PanelAnchor;
}

/** The tools the closed row's parts open (partTool in src/notch/row/parts.ts): the same parts on the bar open them in its panel. */
export const BAR_TOOLS: readonly string[] = ["media", "timer", "usage", "system", "notices", "overview", "shelf", "weather", "discord", "github", "leetcode", "calendar"];

/** The tool's id, or the kind ("tray", "apps", "quick") for any other content: the panel crossfades when it changes. */
export const panelKey = (c: PanelContent) => (c.kind === "tool" ? c.tool : c.kind);
/** The same content closes the panel on a second click, another takes its place. The kind counts too, so no tool id passes for the tray. */
export const sameContent = (a: PanelContent, b: PanelContent) => a.kind === b.kind && panelKey(a) === panelKey(b);
/**
 * The same item, known by its span on the bar: two spans that overlap. An item can shift or change width under its open panel (the
 * centre zone recentres as window buttons come and go, a clock widens), while two items never overlap. A zero-width span overlaps nothing.
 */
export const sameAnchor = (a: PanelAnchor, b: PanelAnchor) => a.w > 0 && b.w > 0 && a.x < b.x + b.w && b.x < a.x + a.w;
/** The tray, the quick panel and the widgets' tools open in the bar; any other tool opens in the notch, so a widget added later still opens somewhere. */
export const opensInBar = (c: PanelContent) => c.kind !== "tool" || BAR_TOOLS.includes(c.tool);

/**
 * The notch's record of what each bar's panel shows, by the bar window's label, after a `bar://panel` event (`taskbar_panel`,
 * src-tauri/src/taskbar/panel.rs): `open` is "tray", "apps", "quick" or a tool's id, null once the panel closes. Another window could emit the event
 * by mistake, so the label is only a key, and a payload of another shape leaves the record as it is, the very same object.
 */
export function withPanel(state: Record<string, string>, payload: unknown): Record<string, string> {
  if (typeof payload !== "object" || payload === null) return state;
  const { label, open } = payload as { label?: unknown; open?: unknown };
  if (typeof label !== "string" || !label || (typeof open !== "string" && open !== null)) return state;
  const next = { ...state };
  if (open === null) delete next[label];
  else next[label] = open;
  return next;
}

/** The size a tool's panel has before its tab is known, at 100% scale, CSS px; fitPanel lowers it to the room above the bar. */
export const TOOL_FALLBACK = { w: 400, h: 520 };
/** Room between the bar and the panel's bottom edge, CSS px, as between the bar and its menus. */
export const PANEL_GAP = 8;
/** The least room between the panel and the window's edges, CSS px, as placeMenu keeps for the menus. */
export const PANEL_EDGE = 8;

/**
 * The tray panel's size at 100% for `count` hidden icons of `icon` px: five to a row, each in a button as wide as the bar's (icon + 16)
 * with 12 px round them; one row at least, for the line it shows without icons, and four at most, past which it scrolls.
 */
export const TRAY_SIZE = (icon: number, count: number) => ({ w: 5 * (icon + 16) + 24, h: Math.min(Math.max(Math.ceil(count / 5), 1), 4) * (icon + 16) + 24 });

/**
 * The quick panel's size at 100 %: 12 px round its rows, 10 px between them. The radios (56) and the brightness (40) only where they
 * apply; the volume, the saver and airplane chips (40 each) and the footer (32) always; `list` is the open output list, with its own
 * separator and no gap of its own.
 */
export function QUICK_SIZE(rows: { radios: boolean; brightness: boolean; list: number }): { w: number; h: number } {
  const heights = [rows.radios ? 56 : 0, 40, rows.brightness ? 40 : 0, 40, 32].filter((h) => h > 0);
  return { w: 360, h: 24 + heights.reduce((a, b) => a + b, 0) + 10 * (heights.length - 1) + rows.list };
}

/** A page inside the quick panel: the Wi-Fi networks or the Bluetooth devices, opened by its tile's chevron. */
export type QuickPage = "wifi" | "bluetooth";
/** A page's row, CSS px. */
export const PAGE_ROW = 40;
/** The rows a page shows before it scrolls. */
export const PAGE_MAX_ROWS = 6;
/** The room the Wi-Fi page's password row adds under its network, CSS px. */
export const PASSWORD_ROW = 44;

/**
 * A quick page's size at 100 %: 12 px round it, the header (32), its rows (one at least, PAGE_MAX_ROWS at most, past which they
 * scroll) plus `extra`, and the footer (32), 10 px between the three.
 */
export const QUICK_PAGE_SIZE = (rows: number, extra: number) => ({ w: 360, h: 24 + 32 + 10 + Math.min(Math.max(rows, 1), PAGE_MAX_ROWS) * PAGE_ROW + extra + 10 + 32 });

/** The page the quick panel keeps: none once the page's radio is gone (adapter removed), the same while it is only off or not read yet. */
export function pageAfter(page: QuickPage | null, quick: { wifi: boolean | null; bluetooth: boolean | null } | null): QuickPage | null {
  if (page === null || (quick !== null && quick[page] === null)) return null;
  return page;
}

/** A tool's size in the panel: its size in the notch less the notch's tool bar, which the panel does not have. */
export const toolPanelSize = (size: { w: number; h: number }) => ({ w: size.w, h: size.h - DOCK_HEIGHT });

/**
 * The size in unzoomed CSS px whose box, drawn at Crest's scale (`zoom`), fits `room`: each side lowered to fit, and rounded down
 * so the drawn box stays inside the room.
 */
export const fitPanel = (size: { w: number; h: number }, room: { w: number; h: number }, zoom: number) => ({
  w: Math.floor(Math.min(size.w, room.w / zoom)),
  h: Math.floor(Math.min(size.h, room.h / zoom)),
});

/** The slot a dragged icon lands in among the bar's buttons (`slots`, in their order): before the first whose centre is right of `x`, else after the last. */
export function dropSlot(slots: { x: number; w: number }[], x: number): number {
  const i = slots.findIndex((s) => s.x + s.w / 2 > x);
  return i < 0 ? slots.length : i;
}
