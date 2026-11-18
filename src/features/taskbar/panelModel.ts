// The rules of the panel above Crest's bar: what it shows, which tools open in it, how big it is, how the app menu lists the apps
// and where an app dragged out of it is pinned. Pure, so they can be tested without the app around them.

import { DOCK_HEIGHT } from "../../notch/geometry.ts";
import { searchApps, type Favorite, type LauncherApp } from "../launcher/apps.ts";

/** What the panel shows: the app menu, a tool by the id the notch opens it with, or the tray's hidden icons. */
export type PanelContent = { kind: "apps" } | { kind: "tool"; tool: string } | { kind: "tray" };
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

/** "apps", "tray" or the tool's id: the panel crossfades when it changes. */
export const panelKey = (c: PanelContent) => (c.kind === "tool" ? c.tool : c.kind);
/** The same content closes the panel on a second click, another takes its place. The kind counts too, so no tool id passes for the app menu. */
export const sameContent = (a: PanelContent, b: PanelContent) => a.kind === b.kind && panelKey(a) === panelKey(b);
/**
 * The same item, known by its span on the bar: two spans that overlap. An item can shift or change width under its open panel (the
 * centre zone recentres as window buttons come and go, a clock widens), while two items never overlap. A zero-width span overlaps nothing.
 */
export const sameAnchor = (a: PanelAnchor, b: PanelAnchor) => a.w > 0 && b.w > 0 && a.x < b.x + b.w && b.x < a.x + a.w;
/** The app menu, the tray and the widgets' tools open in the bar; any other tool opens in the notch, so a widget added later still opens somewhere. */
export const opensInBar = (c: PanelContent) => c.kind !== "tool" || BAR_TOOLS.includes(c.tool);

/**
 * The notch's record of what each bar's panel shows, by the bar window's label, after a `bar://panel` event (`taskbar_panel`,
 * src-tauri/src/taskbar/panel.rs): `open` is "apps", "tray" or a tool's id, null once the panel closes. Another window could emit the event
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

/** The app menu's size at 100% scale, CSS px; fitPanel lowers it to the room above the bar. */
export const APPS_SIZE = { w: 400, h: 520 };
/** Room between the bar and the panel's bottom edge, CSS px, as between the bar and its menus. */
export const PANEL_GAP = 8;
/** The least room between the panel and the window's edges, CSS px, as placeMenu keeps for the menus. */
export const PANEL_EDGE = 8;

/**
 * The tray panel's size at 100% for `count` hidden icons of `icon` px: five to a row, each in a button as wide as the bar's (icon + 16)
 * with 12 px round them, as the app menu's; one row at least, for the line it shows without icons, and four at most, past which it scrolls.
 */
export const TRAY_SIZE = (icon: number, count: number) => ({ w: 5 * (icon + 16) + 24, h: Math.min(Math.max(Math.ceil(count / 5), 1), 4) * (icon + 16) + 24 });

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

/** A row of the app menu's list: a letter over the apps whose names start with it, or an app. */
export type AppRow = { kind: "letter"; letter: string } | { kind: "app"; app: LauncherApp };

/** The letter an app's name is listed under: its first letter without accents, upper case; "#" for a name that starts with a digit or a sign. */
export function initialOf(name: string): string {
  const first = [...name.trim().normalize("NFD").replace(/\p{M}/gu, "")][0] ?? "";
  return /\p{L}/u.test(first) ? first.toUpperCase() : "#";
}

/**
 * The app menu's list: with no search every app in the list's order, which is by name (mergeApps), a letter over each run of apps
 * that start with it; with a search the Launcher's matches, AI apps first, where letters would only break up that order.
 */
export function appRows(apps: LauncherApp[], query: string): AppRow[] {
  if (query.trim()) return searchApps(apps, query, Infinity).map((app) => ({ kind: "app", app }));
  return apps.flatMap((app, i): AppRow[] => {
    const letter = initialOf(app.name);
    const row: AppRow = { kind: "app", app };
    return i > 0 && initialOf(apps[i - 1].name) === letter ? [row] : [{ kind: "letter", letter }, row];
  });
}

/** The slot a dragged app lands in among the bar's pinned buttons (`slots`, in their order): before the first whose centre is right of `x`, else after the last. */
export function dropSlot(slots: { x: number; w: number }[], x: number): number {
  const i = slots.findIndex((s) => s.x + s.w / 2 > x);
  return i < 0 ? slots.length : i;
}

/**
 * The pinned apps with `app` at `slot` of the order as the bar shows it: a pinned app moves there, so a slot right before or right
 * after it leaves the order as it is; a new one goes in, at the end for a slot past it. A pin keeps only its id and name.
 */
export function pinAt(pinned: Favorite[], app: Favorite, slot: number): Favorite[] {
  const from = pinned.findIndex((f) => f.id === app.id);
  const next = pinned.filter((f) => f.id !== app.id);
  // The slots after a pinned app's own place count that place, which `next` no longer has.
  next.splice(from >= 0 && slot > from ? slot - 1 : slot, 0, app);
  return next.map(({ id, name }) => ({ id, name }));
}
