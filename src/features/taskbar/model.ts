// Settings model of Crest's bar and the rules of its buttons and menus. Pure, so the saved shape can be repaired and the rules
// tested without the app around them.

import { normalizeFavorites, type Favorite } from "../launcher/apps.ts";
import { PART_IDS, partTool, type PartId } from "../../notch/row/parts.ts";
import { TOOL_IDS } from "../../settings/tools.ts";

/** The bar's zones. Physical, as the closed row's: left stays left in a right-to-left language. */
export type Zone = "left" | "center" | "right";
/** A button that opens a tool, by the id the notch opens it with: `tool:notes`. The prefix keeps it apart from a part of the same id. */
export type ToolItem = `tool:${string}`;
/** What the zones hold: Windows' Start button ("start"), the apps (pinned and open), the Crest button, the notification area ("tray"), Stato (network, volume and battery, "status"), the closed notch's parts as widgets and buttons that open a tool (`tool:<id>`). */
export type BarItem = "start" | "apps" | "crest" | "tray" | "status" | PartId | ToolItem;
/** The items every bar has: one missing from the zones is put back in its default place. The tray, Stato and the widgets can be taken off. */
export const FIXED_ITEMS = ["start", "apps", "crest"] as const;
/** The bar's shape: along the screen's edge with no gaps, floating above it, a capsule, or a tile per item. */
export type BarShape = "docked" | "floating" | "capsule" | "tiles";

/**
 * The bar: on or off, the items in each zone, the bar's height and its icons' size in CSS px, its background (the closed
 * notch's or the theme's), the pinned apps (null: never seeded), the ids Windows' taskbar had pinned when the notch last read them,
 * with those a read missed (null: never read; store.ts follows what changes there), its shape, its transparency in percent, its glass
 * and the glass's look, the bar clock's own date and seconds, and whether the default widgets, the tray and Stato were placed (once, so one taken off
 * stays off). The tray keeps the icons in `trayShown` (TrayIcon.id) on the bar; the others are in the panel behind its ^ button.
 */
export interface TaskbarSettings {
  enabled: boolean;
  /** Each bar slides off its screen while the window in front of its monitor touches it (autoHide.ts). */
  autoHide: boolean;
  zones: Record<Zone, BarItem[]>;
  height: number;
  iconSize: number;
  surface: "notch" | "theme";
  pinned: Favorite[] | null;
  windowsPins: string[] | null;
  shape: BarShape;
  transparency: number;
  glass: boolean;
  /** Under `glass`, the look of the bar's glass, Crest's or Liquid Glass + (look.ts `barLook`); `glass` alone gates the live copy and its exclusion from captures (contract point 1). */
  glassLook: "crest" | "plus";
  clock: { date: boolean; seconds: boolean };
  /** The version of each widget that has more than one, by widget; the clock's date stays in `clock`, the only source for the notch and older copies. */
  variants: Partial<WidgetVariants>;
  widgetsSeeded: boolean;
  traySeeded: boolean;
  statusSeeded: boolean;
  trayShown: string[];
}

export const TASKBAR_DEFAULTS: TaskbarSettings = {
  enabled: false,
  autoHide: false,
  zones: { left: [], center: ["start", "apps"], right: ["weather", "tray", "status", "clock", "crest"] },
  height: 44,
  iconSize: 24,
  surface: "notch",
  pinned: null,
  windowsPins: null,
  shape: "floating",
  transparency: 0,
  glass: false,
  glassLook: "crest",
  clock: { date: true, seconds: false },
  variants: {},
  widgetsSeeded: true,
  traySeeded: true,
  statusSeeded: true,
  trayShown: [],
};

/** The heights and icon sizes the settings offer, CSS px. */
export const HEIGHT = [32, 64] as const;
export const ICON = [16, 40] as const;
/** The transparency the settings offer, percent. */
export const TRANSPARENCY = [0, 100] as const;
const SHAPES: BarShape[] = ["docked", "floating", "capsule", "tiles"];

/** The icon size drawn in a bar this tall: 6 px clear above and below. The saved size stays, so a taller bar gives it back. */
export const fitIcon = (height: number, icon: number) => Math.min(icon, height - 12);
/** A tray icon's size beside apps' icons of `size`: Windows' 16 to 24, and the widgets' glyphs, at every icon size. */
export const trayIcon = (size: number) => Math.round((size * 2) / 3);
/** An app button's icon once the apps narrow to fit, and the padding round it: 24 in 30 at the default. */
export const compactIcon = (size: number) => Math.round((size * 5) / 6);
export const COMPACT_PAD = 10;

const ZONES: Zone[] = ["left", "center", "right"];
/** The tools whose widget opens the same panel, a part named as its tool (partTool): a button would repeat it, so the bar does not offer them. */
const WIDGET_TOOLS: readonly string[] = PART_IDS.filter((p) => partTool(p) === p);
/** The tools a button on the bar can open: Crest's tools but those, then Find on screen, a page (tabs.ts findOnScreenTab). */
export const TOOL_BUTTONS: readonly string[] = [...TOOL_IDS.filter((id) => !WIDGET_TOOLS.includes(id)), "find"];
/** Every item a zone may hold. */
const ITEMS: string[] = [...FIXED_ITEMS, "tray", "status", ...PART_IDS, ...TOOL_BUTTONS.map((id) => `tool:${id}`)];

/** The versions a widget offers on the bar, today's first; the id stays bare in the zones, so the fit, the sources and `barParts` do not change. */
export type WidgetVariants = { weather: "temp" | "icon" | "condition" | "hours"; clock: "digital" | "analog" | "zones"; readings: "dials" | "bars" | "line"; timer: "countdown" | "ring" };
export const WIDGET_VARIANTS: { [K in keyof WidgetVariants]: readonly WidgetVariants[K][] } = {
  weather: ["temp", "icon", "condition", "hours"],
  clock: ["digital", "analog", "zones"],
  readings: ["dials", "bars", "line"],
  timer: ["countdown", "ring"],
};

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Whether `variants` names a version `id` has, as its own key: other windows get the raw JSON (widgets.ts). */
const isVariant = (variants: unknown, id: keyof WidgetVariants): boolean =>
  isObj(variants) && Object.hasOwn(variants, id) && (WIDGET_VARIANTS[id] as readonly unknown[]).includes(variants[id]);
/** The version a widget draws: its saved one, or today's look for anything it does not know. */
export const variantOf = <K extends keyof WidgetVariants>(variants: unknown, id: K): WidgetVariants[K] =>
  isVariant(variants, id) ? ((variants as Record<string, unknown>)[id] as WidgetVariants[K]) : WIDGET_VARIANTS[id][0];
const within = (v: unknown, [min, max]: readonly [number, number], fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v))) : fallback;

/**
 * Whatever was saved (nothing before the bar existed) becomes valid bar settings. The icon size is held to its own range, not to
 * the height: every window that loads saves this, so a lower bar would shrink it for good (fitIcon shrinks it where it is drawn).
 */
export function normalizeTaskbar(v: unknown): TaskbarSettings {
  const s = isObj(v) ? v : {}, d = TASKBAR_DEFAULTS, clock = isObj(s.clock) ? s.clock : {};
  // Settings saved before the widgets, the tray or Stato get the default ones once; the flags are saved with them, so one taken off stays off.
  const widgets = normalizeZones(s.zones, s.widgetsSeeded !== true);
  const tray = s.traySeeded === true ? widgets : withItem(widgets, "tray");
  const zones = s.statusSeeded === true ? tray : withItem(tray, "status");
  return {
    enabled: s.enabled === true,
    autoHide: s.autoHide === true,
    zones,
    height: within(s.height, HEIGHT, d.height),
    iconSize: within(s.iconSize, ICON, d.iconSize),
    surface: s.surface === "theme" ? "theme" : "notch",
    pinned: normalizeFavorites(s.pinned),
    windowsPins: Array.isArray(s.windowsPins) ? [...new Set(s.windowsPins.filter((id): id is string => typeof id === "string"))] : null,
    shape: SHAPES.includes(s.shape as BarShape) ? (s.shape as BarShape) : d.shape,
    transparency: within(s.transparency, TRANSPARENCY, d.transparency),
    glass: s.glass === true,
    glassLook: s.glassLook === "plus" ? "plus" : "crest",
    clock: { date: clock.date !== false, seconds: clock.seconds === true },
    // A copy older than this rebuilds the settings field by field and drops `variants` at its first save (design 6D): accepted.
    variants: Object.fromEntries(
      (Object.keys(WIDGET_VARIANTS) as (keyof WidgetVariants)[]).filter((id) => isVariant(s.variants, id)).map((id) => [id, (s.variants as Record<string, unknown>)[id]]),
    ),
    widgetsSeeded: true,
    traySeeded: true,
    statusSeeded: true,
    trayShown: Array.isArray(s.trayShown) ? [...new Set(s.trayShown.filter((x): x is string => typeof x === "string"))] : [],
  };
}

/** The zones with the tray or Stato put in once, before the clock in its zone, else before the Crest button (at the end of the right zone with neither); one already on the bar leaves them as they are. */
function withItem(zones: Record<Zone, BarItem[]>, id: "tray" | "status"): Record<Zone, BarItem[]> {
  if (ZONES.some((z) => zones[z].includes(id))) return zones;
  const zone = (x: BarItem) => ZONES.find((z) => zones[z].includes(x));
  const before = zone("clock") ? "clock" : "crest", to = zone(before) ?? "right";
  const at = zones[to].indexOf(before);
  const items = [...zones[to]];
  items.splice(at < 0 ? items.length : at, 0, id);
  return { ...zones, [to]: items };
}

/** Whether a zone holds the tray: what the notch sends Rust (`taskbar.trayOn`), on or off, so turning the bar off never stops the spy before Windows' taskbar is back. */
export const trayOnBar = (zones: Record<Zone, BarItem[]>): boolean => ZONES.some((z) => zones[z].includes("tray"));

/** Whether the spy that records the tray's icons runs: while the bar is on and a zone holds the tray; otherwise Explorer keeps the tray alone. */
export const trayWanted = (t: TaskbarSettings): boolean => t.enabled && trayOnBar(t.zones);

/** Whether Rust follows the network and the volume for the bar (`status.barOn`): while the bar is on and a zone holds Stato. */
export const statusWanted = (t: TaskbarSettings): boolean => t.enabled && ZONES.some((z) => t.zones[z].includes("status"));

/**
 * Each fixed item in exactly one zone and each widget in one at most: unknown ids dropped (a tool button for a tool the bar does not offer too), a duplicate kept at its first place
 * reading left, center, right, and a missing fixed item back in its default zone at its default index (the end when the zone is
 * shorter). A missing widget, tray or Stato is off the bar; `seed` puts the default widgets back the same way (the tray and Stato come with normalizeTaskbar).
 */
export function normalizeZones(v: unknown, seed = false): Record<Zone, BarItem[]> {
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
    // Without the tray and Stato, which are no fixed items: they would push the indexes of the others past what they were.
    TASKBAR_DEFAULTS.zones[z].filter((id) => id !== "tray" && id !== "status").forEach((id, i) => {
      if (!seen.has(id) && (FIXED_ITEMS.includes(id as never) || (seed && PART_IDS.includes(id as PartId)))) zones[z].splice(i, 0, id);
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

/** What changed on Windows' taskbar, on the bar's pinned apps: those pinned there at the end unless already pinned, those unpinned there taken off; the rest keep their order. */
export function applyWindowsPins(pinned: Favorite[], change: { added: Favorite[]; removed: string[] }): Favorite[] {
  const kept = pinned.filter((f) => !change.removed.includes(f.id));
  return [...kept, ...change.added.filter((f) => !kept.some((k) => k.id === f.id))];
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

/**
 * An icon in the tray (tray.rs). `key` tells it apart from every other icon while it lives (React keys, `taskbar.trayClick`); `id`
 * names it across restarts, for the choice to keep it visible, and two instances of one program can share it; `img` keys its
 * picture for `taskbar.trayImages`, null for none.
 */
export interface TrayIcon {
  id: string;
  key: string;
  tip: string;
  img: string | null;
}
/** The tray's icons, none while Crest's tray does not run; `yielded` when another program's tray has them. */
export interface TrayState {
  yielded: boolean;
  icons: TrayIcon[];
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
