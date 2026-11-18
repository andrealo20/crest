// Settings model of Crest's bar and the rules of its buttons and menus. Pure, so the saved shape can be repaired and the rules
// tested without the app around them.

import { normalizeFavorites, type Favorite } from "../launcher/apps.ts";

/** The bar's zones. Physical, as the closed row's: left stays left in a right-to-left language. */
export type Zone = "left" | "center" | "right";
/** What the zones hold: the apps (pinned and open) and the Crest button. Phase 3 adds "start", phase 4 the parts. */
export type BarItem = "apps" | "crest";
/** The bar's shape: along the screen's edge with no gaps, floating above it, a capsule, or a tile per item. */
export type BarShape = "docked" | "floating" | "capsule" | "tiles";

/**
 * The bar: on or off, the items in each zone, the bar's height and its icons' size in CSS px, its background (the closed
 * notch's or the theme's), the pinned apps (null: never seeded), its shape, its transparency in percent and its glass.
 */
export interface TaskbarSettings {
  enabled: boolean;
  zones: Record<Zone, BarItem[]>;
  height: number;
  iconSize: number;
  surface: "notch" | "theme";
  pinned: Favorite[] | null;
  shape: BarShape;
  transparency: number;
  glass: boolean;
}

export const TASKBAR_DEFAULTS: TaskbarSettings = {
  enabled: false,
  zones: { left: [], center: ["apps"], right: ["crest"] },
  height: 44,
  iconSize: 24,
  surface: "notch",
  pinned: null,
  shape: "floating",
  transparency: 0,
  glass: false,
};

/** The heights and icon sizes the settings offer, CSS px. */
export const HEIGHT = [32, 64] as const;
export const ICON = [16, 40] as const;
/** The transparency the settings offer, percent. */
export const TRANSPARENCY = [0, 100] as const;
const SHAPES: BarShape[] = ["docked", "floating", "capsule", "tiles"];

/** The icon size drawn in a bar this tall: 6 px clear above and below. The saved size stays, so a taller bar gives it back. */
export const fitIcon = (height: number, icon: number) => Math.min(icon, height - 12);

const ZONES: Zone[] = ["left", "center", "right"];
/** Every item has a default place, so the defaults list them all. */
const ITEMS = ZONES.flatMap((z) => TASKBAR_DEFAULTS.zones[z]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const within = (v: unknown, [min, max]: readonly [number, number], fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v))) : fallback;

/**
 * Whatever was saved (nothing before the bar existed) becomes valid bar settings. The icon size is held to its own range, not to
 * the height: every window that loads saves this, so a lower bar would shrink it for good (fitIcon shrinks it where it is drawn).
 */
export function normalizeTaskbar(v: unknown): TaskbarSettings {
  const s = isObj(v) ? v : {}, d = TASKBAR_DEFAULTS;
  return {
    enabled: s.enabled === true,
    zones: normalizeZones(s.zones),
    height: within(s.height, HEIGHT, d.height),
    iconSize: within(s.iconSize, ICON, d.iconSize),
    surface: s.surface === "theme" ? "theme" : "notch",
    pinned: normalizeFavorites(s.pinned),
    shape: SHAPES.includes(s.shape as BarShape) ? (s.shape as BarShape) : d.shape,
    transparency: within(s.transparency, TRANSPARENCY, d.transparency),
    glass: s.glass === true,
  };
}

/**
 * Every item in exactly one zone: unknown ids dropped, a duplicate kept at its first place reading left, center, right, and a
 * missing item back in its default zone at its default index (the end when the zone is shorter).
 */
export function normalizeZones(v: unknown): Record<Zone, BarItem[]> {
  const s = isObj(v) ? v : {};
  const seen = new Set<BarItem>();
  const zones: Record<Zone, BarItem[]> = { left: [], center: [], right: [] };
  for (const z of ZONES) {
    const saved = s[z];
    for (const id of Array.isArray(saved) ? saved : []) {
      if (!ITEMS.includes(id) || seen.has(id)) continue;
      seen.add(id);
      zones[z].push(id);
    }
  }
  for (const z of ZONES) {
    // splice puts an index past the end at the end.
    TASKBAR_DEFAULTS.zones[z].forEach((id, i) => {
      if (!seen.has(id)) zones[z].splice(i, 0, id);
    });
  }
  return zones;
}

/** The zones with `id` moved into `to` at `index` (the end without one, or past the end); an id in no zone leaves them as they are. */
export function moveItem(zones: Record<Zone, BarItem[]>, id: BarItem, to: Zone, index?: number): Record<Zone, BarItem[]> {
  if (!ZONES.some((z) => zones[z].includes(id))) return zones;
  const next = { left: zones.left.filter((x) => x !== id), center: zones.center.filter((x) => x !== id), right: zones.right.filter((x) => x !== id) };
  next[to].splice(Math.max(0, index ?? next[to].length), 0, id);
  return next;
}

// What Rust sends the bar (src-tauri/src/taskbar/tasks.rs).

/** An open window; `id` is its handle, which fits a JS number. */
export interface Win {
  id: number;
  title: string;
  minimized: boolean;
  flashing: boolean;
}
/** A Start menu or App Paths entry that opens an app, as the launcher lists it. */
export type Pin = Favorite;
/** One app's open windows, with the entries that open it (none for a program without one). */
export interface Group {
  key: string;
  name: string;
  pins: Pin[];
  windows: Win[];
}
/** The groups in the bar's order, and the listed window in front (null: none). */
export interface WindowList {
  groups: Group[];
  active: number | null;
}

/** A button on the bar: a pinned app (`pin`) with the windows it owns, or an open app that is not pinned; `pins` are the entries that start it. */
export interface BarButton {
  key: string;
  name: string;
  pin: Favorite | null;
  pins: Favorite[];
  windows: Win[];
}

/**
 * The pinned apps first, in their order and with their saved names, each owning every group whose first pinned entry it is;
 * then the groups no pinned app owns, in Rust's order.
 */
export function barButtons(pinned: Favorite[] | null, groups: Group[]): BarButton[] {
  const pins = pinned ?? [];
  const ids = new Set(pins.map((f) => f.id));
  const owner = (g: Group) => g.pins.find((p) => ids.has(p.id))?.id;
  const buttons: BarButton[] = pins.map((f) => ({ key: f.id, name: f.name, pin: f, pins: [f], windows: groups.filter((g) => owner(g) === f.id).flatMap((g) => g.windows) }));
  for (const g of groups) if (owner(g) === undefined) buttons.push({ key: g.key, name: g.name, pin: null, pins: g.pins, windows: g.windows });
  return buttons;
}

/** The entry that starts the app, or null for a program Crest cannot start. */
export const launchId = (b: BarButton): string | null => b.pin?.id ?? b.pins[0]?.id ?? null;

/** A left click: start the app, bring its one window forward or minimize it, list its windows, or nothing. */
export type Click = { kind: "launch"; id: string } | { kind: "toggle"; id: number } | { kind: "list" } | { kind: "none" };

export function clickAction(b: BarButton): Click {
  if (b.windows.length > 1) return { kind: "list" };
  if (b.windows.length === 1) return { kind: "toggle", id: b.windows[0].id };
  const id = launchId(b);
  return id === null ? { kind: "none" } : { kind: "launch", id };
}

/** The mark under a button: a window asks for attention, one is in front, some are open, or none. */
export type Indicator = "attention" | "front" | "open" | "none";

export function indicator(b: BarButton, active: number | null): Indicator {
  if (b.windows.some((w) => w.flashing)) return "attention";
  if (b.windows.some((w) => w.id === active)) return "front";
  return b.windows.length ? "open" : "none";
}

/** The right-click menu's entries, in order. */
export type MenuEntry = "newWindow" | "pin" | "unpin" | "close" | "closeAll";

/** New window and Pin only for an app Crest can start (it has an entry), Unpin for a pinned one, Close for its open windows. */
export function menuFor(b: BarButton): MenuEntry[] {
  const entries: MenuEntry[] = [];
  if (launchId(b) !== null) entries.push("newWindow");
  if (b.pin) entries.push("unpin");
  else if (b.pins.length) entries.push("pin");
  if (b.windows.length === 1) entries.push("close");
  else if (b.windows.length > 1) entries.push("closeAll");
  return entries;
}

/** The left edge of a menu centred over its anchor and kept `edge` px inside the window; a menu wider than the window starts at the left edge. */
export const placeMenu = (anchorX: number, anchorW: number, menuW: number, viewW: number, edge = 8) =>
  Math.max(edge, Math.min(anchorX + anchorW / 2 - menuW / 2, viewW - edge - menuW));

/** The row a key moves to among a menu's `count` rows from row `at` (-1: none): Up and Down wrap, Home and End go to the ends; undefined for any other key. */
export function menuKey(key: string, at: number, count: number): number | undefined {
  const to = key === "ArrowDown" ? at + 1 : key === "ArrowUp" ? (at < 0 ? count : at) - 1 : key === "Home" ? 0 : key === "End" ? count - 1 : undefined;
  return to === undefined || !count ? undefined : (to + count) % count;
}

/** The Taskbar settings show in the Windows app only: in a dev build, in a build marked for the preview, and while the bar is on, so it can be turned off. */
export const taskbarShown = (p: { native: boolean; mac: boolean; dev: boolean; preview: boolean; enabled: boolean }): boolean =>
  p.native && !p.mac && (p.dev || p.preview || p.enabled);
