// Settings model of Crest's bar and the rules of its buttons and menus. Pure, so the saved shape can be repaired and the rules
// tested without the app around them.

import { normalizeFavorites, type Favorite } from "../launcher/apps.ts";
import { PART_IDS, partTool, type PartId } from "../../notch/row/parts.ts";
import { TOOL_IDS } from "../../settings/tools.ts";
import { folderKey, normalizeFolders, type Folder } from "./folderModel.ts";
import { dropSlot } from "./panelModel.ts";
import { WHATSAPP, normalizeUnread } from "./unread.ts";

/** The bar's zones. Physical, as the closed row's: left stays left in a right-to-left language. */
export type Zone = "left" | "center" | "right";
/** A button that opens a tool, by the id the notch opens it with: `tool:notes`. The prefix keeps it apart from a part of the same id. */
export type ToolItem = `tool:${string}`;
/**
 * Windows' own buttons the bar can hold: Search, Task view, Windows widgets, Show desktop, the input language, the privacy indicators,
 * the Recycle Bin, Windows' dark theme, the On-Screen Keyboard, the notification centre, Do not disturb, the files opened last, a search
 * box, the desktop's icons, ejecting a USB drive and the mobile hotspot. Not in the default zones: an update changes no bar.
 */
export const SYS_IDS = ["search", "taskview", "widgets", "desktop", "input", "privacy", "recycle", "theme", "keyboard", "notifications", "dnd", "recent", "searchbox", "deskicons", "eject", "hotspot"] as const;
export type SysId = (typeof SYS_IDS)[number];
/** A Windows button, by its id: `sys:search`. */
export type SysItem = `sys:${SysId}`;

/** The Recycle Bin button's name: a key for t() and its values; null, before the first count, reads as empty. */
export const recycleName = (n: number | null): [string, Record<string, number>?] =>
  !n ? ["Papierkorb ist leer"] : n === 1 ? ["Papierkorb: 1 Element"] : ["Papierkorb: {n} Elemente", { n }];
/** What the bin's panel says before its red button empties it: how many items go for good, one in the singular; null reads as empty. */
export const emptyWarning = (n: number | null): [string, Record<string, number>?] =>
  !n
    ? ["Der Papierkorb ist leer"]
    : n === 1
      ? ["1 Element wird endgültig gelöscht. Das lässt sich nicht rückgängig machen."]
      : ["{n} Elemente werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.", { n }];
/** What the zones hold: Windows' Start button ("start"), the apps (pinned and open), the Crest button, the notification area ("tray"), Stato (network, volume and battery, "status"), the closed notch's parts as widgets, buttons that open a tool (`tool:<id>`) and Windows' own buttons (`sys:<id>`). */
export type BarItem = "start" | "apps" | "crest" | "tray" | "status" | PartId | ToolItem | SysItem;
/** The items every bar has: one missing from the zones is put back in its default place. The Crest button, the tray, Stato and the widgets can be taken off. */
export const FIXED_ITEMS = ["start", "apps"] as const;
/** The bar's shape: along the screen's edge with no gaps, floating above it, a capsule, or a tile per item. */
export type BarShape = "docked" | "floating" | "capsule" | "tiles";
/** The screen edge the bars stand on. */
export type BarEdge = "bottom" | "top";
/** How the apps' buttons combine, as Windows' "Combine taskbar buttons and hide labels": one per app with no label, one per window with its title while they fit, or one per window always. */
export type Combine = "always" | "full" | "never";
const COMBINES: Combine[] = ["always", "full", "never"];
/** What a double click on the bar's empty space does: nothing, Show desktop, or Task Manager. */
export type EmptyDouble = "none" | "desktop" | "taskmgr";
const EMPTY_DOUBLES: EmptyDouble[] = ["none", "desktop", "taskmgr"];

/**
 * The bar: on or off, the items in each zone, the bar's height and its icons' size in CSS px, its background (the closed
 * notch's or the theme's), the pinned apps (null: never seeded), the ids Windows' taskbar had pinned when the notch last read them,
 * with those a read missed (null: never read; store.ts follows what changes there), its shape, its transparency in percent, its glass
 * and the glass's look, the bar clock's own date and seconds, and whether the default widgets, the tray and Stato were placed (once, so one taken off
 * stays off). The tray keeps the icons in `trayShown` (TrayIcon.id) on the bar; the others are in the panel behind its ^ button, those
 * in `trayHidden` first in its order.
 */
export interface TaskbarSettings {
  enabled: boolean;
  /** Each bar slides off its screen while the window in front of its monitor touches it (autoHide.ts). */
  autoHide: boolean;
  zones: Record<Zone, BarItem[]>;
  height: number;
  iconSize: number;
  /** The widgets' size against the icons', percent: at 100 they follow the icons as before (widgets.ts widgetScale). */
  widgetSize: number;
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
  trayHidden: string[];
  /** The app menu has End task (off by default, as in Windows: it ends the app without saving). */
  endTask: boolean;
  /** One button per app ("always", Windows' default), one per window while titles fit ("full"), or one per window ("never"); the same on every bar. */
  combine: Combine;
  /** A double click on the bar beside its buttons, or in the gap under it. */
  emptyDouble: EmptyDouble;
  /** An app asking for attention pulses and holds the bar up, as Windows' "Show flashing on taskbar apps". */
  flashing: boolean;
  /** The middle button on an app with windows: a new instance (Windows' default) or close them all. */
  middleClick: "new" | "close";
  /** A small count of its windows on an app with two or more. */
  windowCount: boolean;
  /** The wheel over the whole bar changes the volume: an app's own over its button, Windows' elsewhere (over Stato it always does). */
  wheelVolume: boolean;
  /** The battery's percentage after it, in Stato and the Battery widget's Classic version. */
  batteryPercent: boolean;
  /** A faint glow of colour along the search panel's edge (window/SearchGlow.tsx). */
  searchGlow: boolean;
  /** The other monitors get a bar too, as Windows' "Show my taskbar on all displays". */
  allScreens: boolean;
  /** Where an app's button shows with several bars: the bar of its window's monitor, that one and the main bar, or every bar. */
  appsOn: AppsOn;
  /** The clock shows on the other monitors' bars too; the other widgets stay on the main bar. */
  clockAll: boolean;
  /** Win+1..9, Win+0, Win+T and Win+B go to the bar (keys.rs); off by default, since turning it on or off restarts Explorer. */
  winKeys: boolean;
  /** The screen edge every bar stands on (position.ts). */
  position: BarEdge;
  /** The mark under an open app (itemLook.ts markShape). */
  marks: MarkStyle;
  /** The Start button's icon on every bar (window/StartMark.tsx). */
  startIcon: StartIcon;
  /** The bar lists the windows of every virtual desktop, as Windows' "Show taskbar apps on all desktops". */
  allDesktops: boolean;
  /** The crypto widget's coin, priced in the Depot's base currency. */
  coin: CryptoCoin;
  /** Its stock in its Stock version, by its Yahoo Finance symbol (stockSymbol), priced in its own currency. */
  stock: string;
  /** What its line and its change span, in every version. */
  marketRange: MarketRange;
  /** The apps the Unread widget counts, lower-case AppUserModelIDs in the order picked, three at most (unread.ts). */
  unread: string[];
  /** Folders of pinned apps; the apps stay in `pinned` (folderModel.ts). */
  folders: Folder[];
}

export type MarkStyle = "dot" | "large" | "line";
export const MARK_STYLES: readonly MarkStyle[] = ["dot", "large", "line"];
/** The Start button's icons, the default first. */
export type StartIcon = "windows" | "crest" | "dots" | "rocket" | "sparkle" | "star";
export const START_ICONS: readonly StartIcon[] = ["windows", "crest", "dots", "rocket", "sparkle", "star"];
/** A Yahoo Finance symbol as the crypto widget keeps it: trimmed, upper case, 1 to 15 of the letters, digits and marks its symbols use
 *  ("AAPL", "VWCE.DE", "BRK-B", "^GSPC"), with a letter or digit among them (prices.rs `stock_url` asks the same); null otherwise. */
export function stockSymbol(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return /^[A-Z0-9.^=-]{1,15}$/.test(s) && /[A-Z0-9]/.test(s) ? s : null;
}

/** What the crypto widget's line and change span: today (a coin's last 24 hours, a stock's last session), a week, a month or a year. */
export type MarketRange = "1d" | "1w" | "1m" | "1y";
export const MARKET_RANGES: readonly MarketRange[] = ["1d", "1w", "1m", "1y"];

/** The coins the crypto widget offers, Bitcoin first. */
export const CRYPTO_COINS = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "LTC"] as const;
export type CryptoCoin = (typeof CRYPTO_COINS)[number];

export type AppsOn = "own" | "main" | "all";
const APPS_ONS: AppsOn[] = ["own", "main", "all"];

export const TASKBAR_DEFAULTS: TaskbarSettings = {
  enabled: false,
  autoHide: false,
  zones: { left: [], center: ["start", "apps"], right: ["weather", "tray", "status", "clock", "crest"] },
  height: 44,
  iconSize: 24,
  widgetSize: 100,
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
  trayHidden: [],
  endTask: false,
  combine: "always",
  emptyDouble: "none",
  flashing: true,
  middleClick: "new",
  windowCount: false,
  wheelVolume: false,
  batteryPercent: true,
  searchGlow: true,
  allScreens: true,
  appsOn: "own",
  clockAll: false,
  winKeys: false,
  position: "bottom",
  marks: "dot",
  startIcon: "windows",
  allDesktops: false,
  coin: "BTC",
  stock: "AAPL",
  marketRange: "1d",
  unread: [WHATSAPP],
  folders: [],
};

/** The heights and icon sizes the settings offer, CSS px. */
export const HEIGHT = [32, 64] as const;
export const ICON = [16, 40] as const;
/** The widgets' sizes the settings offer, percent of the icons'. */
export const WIDGET_SIZE = [75, 125] as const;
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
const ITEMS: string[] = [...FIXED_ITEMS, "crest", "tray", "status", ...PART_IDS, ...TOOL_BUTTONS.map((id) => `tool:${id}`), ...SYS_IDS.map((id) => `sys:${id}`)];

/** The versions a widget offers on the bar, today's first; the id stays bare in the zones, so the fit, the sources and `barParts` do not change. */
export type WidgetVariants = {
  weather: "temp" | "icon" | "condition" | "hours" | "details" | "forecast" | "sun";
  clock: "digital" | "analog" | "zones" | "flip" | "segment" | "weather";
  readings: "dials" | "bars" | "line" | "net";
  timer: "countdown" | "ring";
  disk: "system" | "all" | "fullest";
  title: "text" | "play" | "cover" | "disc" | "track";
  processes: "cpu" | "ram";
  battery: "ring" | "cells" | "gauge" | "dots" | "classic";
  mic: "mic" | "both";
  progress: "day" | "month" | "year";
  date: "fulldate" | "sheet" | "week";
  world: "world" | "cities";
  temps: "history" | "fans";
  bluetooth: "lowest" | "devices";
  keepawake: "icon" | "left";
  unread: "badge" | "each";
  screentime: "total" | "apps" | "hourly";
  timeline: "fullday" | "ahead";
  wallpaper: "thumb" | "keys";
  crypto: "coin" | "stock" | "portfolio";
};
export const WIDGET_VARIANTS: { [K in keyof WidgetVariants]: readonly WidgetVariants[K][] } = {
  weather: ["temp", "icon", "condition", "hours", "details", "forecast", "sun"],
  clock: ["digital", "analog", "zones", "flip", "segment", "weather"],
  readings: ["dials", "bars", "line", "net"],
  timer: ["countdown", "ring"],
  disk: ["system", "all", "fullest"],
  title: ["text", "play", "cover", "disc", "track"],
  processes: ["cpu", "ram"],
  battery: ["ring", "cells", "gauge", "dots", "classic"],
  mic: ["mic", "both"],
  progress: ["day", "month", "year"],
  date: ["fulldate", "sheet", "week"],
  world: ["world", "cities"],
  temps: ["history", "fans"],
  bluetooth: ["lowest", "devices"],
  keepawake: ["icon", "left"],
  unread: ["badge", "each"],
  screentime: ["total", "apps", "hourly"],
  timeline: ["fullday", "ahead"],
  wallpaper: ["thumb", "keys"],
  crypto: ["coin", "stock", "portfolio"],
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
  const pinned = normalizeFavorites(s.pinned);
  return {
    enabled: s.enabled === true,
    autoHide: s.autoHide === true,
    zones,
    height: within(s.height, HEIGHT, d.height),
    iconSize: within(s.iconSize, ICON, d.iconSize),
    widgetSize: within(s.widgetSize, WIDGET_SIZE, d.widgetSize),
    surface: s.surface === "theme" ? "theme" : "notch",
    pinned,
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
    trayHidden: Array.isArray(s.trayHidden) ? [...new Set(s.trayHidden.filter((x): x is string => typeof x === "string"))] : [],
    endTask: s.endTask === true,
    combine: COMBINES.includes(s.combine as Combine) ? (s.combine as Combine) : d.combine,
    emptyDouble: EMPTY_DOUBLES.includes(s.emptyDouble as EmptyDouble) ? (s.emptyDouble as EmptyDouble) : d.emptyDouble,
    flashing: s.flashing !== false,
    middleClick: s.middleClick === "close" ? "close" : "new",
    windowCount: s.windowCount === true,
    wheelVolume: s.wheelVolume === true,
    batteryPercent: s.batteryPercent !== false,
    searchGlow: s.searchGlow !== false,
    allScreens: s.allScreens !== false,
    appsOn: APPS_ONS.includes(s.appsOn as AppsOn) ? (s.appsOn as AppsOn) : d.appsOn,
    clockAll: s.clockAll === true,
    winKeys: s.winKeys === true,
    position: s.position === "top" ? "top" : "bottom",
    marks: MARK_STYLES.includes(s.marks as MarkStyle) ? (s.marks as MarkStyle) : "dot",
    startIcon: START_ICONS.includes(s.startIcon as StartIcon) ? (s.startIcon as StartIcon) : d.startIcon,
    allDesktops: s.allDesktops === true,
    coin: CRYPTO_COINS.includes(s.coin as CryptoCoin) ? (s.coin as CryptoCoin) : d.coin,
    stock: stockSymbol(s.stock) ?? d.stock,
    marketRange: MARKET_RANGES.includes(s.marketRange as MarketRange) ? (s.marketRange as MarketRange) : d.marketRange,
    unread: normalizeUnread(s.unread, d.unread),
    folders: normalizeFolders(s.folders, pinned),
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

/** Whether a zone holds the Battery widget: Stato and the bar's Hardware widget then leave their battery out, one on the bar is enough. */
export const batteryOnBar = (zones: Record<Zone, BarItem[]>): boolean => ZONES.some((z) => zones[z].includes("battery"));

/** Whether the spy that records the tray's icons runs: while the bar is on and a zone holds the tray; otherwise Explorer keeps the tray alone. */
export const trayWanted = (t: TaskbarSettings): boolean => t.enabled && trayOnBar(t.zones);

/** Whether the bar takes Windows' keys (`taskbar.keys`): while the bar is on and its switch is on. */
export const keysWanted = (t: TaskbarSettings): boolean => t.enabled && t.winKeys;

/** Whether Rust follows the network and the volume for the bar (`status.barOn`): while the bar is on and a zone holds Stato. */
export const statusWanted = (t: TaskbarSettings): boolean => t.enabled && ZONES.some((z) => t.zones[z].includes("status"));

/** Whether Rust follows the microphone and the volume for the bar's Microphone widget (`status.barOn`'s `mic`): while the bar is on and a zone holds it. */
export const micWanted = (t: TaskbarSettings): boolean => t.enabled && ZONES.some((z) => t.zones[z].includes("mic"));

/**
 * Each fixed item in exactly one zone and each widget, tool or Windows button in one at most: unknown ids dropped (a tool button for a tool the bar does not offer too), a duplicate kept at its first place
 * reading left, center, right, and a missing fixed item back in its default zone at its default index (the end when the zone is
 * shorter). A missing widget, tray, Stato or Crest button is off the bar; `seed` puts the default widgets and the Crest button back the same way (the tray and Stato come
 * with normalizeTaskbar): every bar saved before the Crest button could come off holds it, so only a new bar needs it seeded.
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
      if (!seen.has(id) && (FIXED_ITEMS.includes(id as never) || (seed && (PART_IDS.includes(id as PartId) || id === "crest")))) zones[z].splice(i, 0, id);
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

/**
 * The zones with `id` moved into `zone` before `before` (at its end with null), on the saved zones, so the items the bar hides (by
 * the fit, on a secondary bar, a tool switched off) keep their places; the same object when nothing changes, so nothing is written.
 */
export function moveBefore(zones: Record<Zone, BarItem[]>, id: BarItem, zone: Zone, before: BarItem | null): Record<Zone, BarItem[]> {
  if (before === id || !ZONES.some((z) => zones[z].includes(id))) return zones;
  const next = { left: zones.left.filter((x) => x !== id), center: zones.center.filter((x) => x !== id), right: zones.right.filter((x) => x !== id) };
  const at = before === null ? next[zone].length : next[zone].indexOf(before);
  if (at < 0) return zones;
  next[zone].splice(at, 0, id);
  return JSON.stringify(next) === JSON.stringify(zones) ? zones : next;
}

/**
 * Items' Up (-1) and Down (1): `id` moved one row among `shown`, its zone as the page lists it, on the saved zones (moveBefore), so a
 * saved item the page does not list never takes a step; the same object at the ends or for an id not shown.
 */
export function stepItem(zones: Record<Zone, BarItem[]>, shown: BarItem[], id: BarItem, by: -1 | 1): Record<Zone, BarItem[]> {
  const i = shown.indexOf(id), zone = ZONES.find((z) => zones[z].includes(id));
  if (i < 0 || !zone || (by < 0 ? i === 0 : i === shown.length - 1)) return zones;
  return moveBefore(zones, id, zone, by < 0 ? shown[i - 1] : (shown[i + 2] ?? null));
}

/** The arrow that takes the keyboard after a step `by` left the row at `at` of `count`: the one pressed, or the other once it is disabled at that end. */
export const stepFocus = (by: -1 | 1, at: number, count: number): -1 | 1 => (by < 0 ? (at === 0 ? 1 : -1) : at === count - 1 ? -1 : 1);

/** An item drawn on the bar, in DOM order: its zone and its box's left edge and width, CSS px. */
export type DropSlot = { id: BarItem; zone: Zone; x: number; w: number };
/** A zone's box on the grid shapes, CSS px. */
export type ZoneBox = { zone: Zone; x: number; w: number };

/**
 * Where an item dragged to `x` lands: in the zone whose box holds `x` (an empty one narrower than `unit`, the grid's middle,
 * widened to `unit` round its centre and checked first), or without zone boxes (the capsule) in the zone of the item it goes before, of the last one at the end; before the first
 * item whose centre is right of `x`. `line` is the left edge of the 2 px insertion line, centred in the `gap` between buttons. Null
 * outside the zones and on its own place (before itself or its next neighbour, in the capsule even of another zone, or at the end it
 * already is at): nothing to write.
 */
export function dropPlace(id: BarItem, items: DropSlot[], zones: ZoneBox[] | null, x: number, unit: number, gap: number): { zone: Zone; before: BarItem | null; line: number } | null {
  let zone: Zone, inZone: DropSlot[], at: number;
  if (zones) {
    const narrow = (z: ZoneBox) => z.w < unit && !items.some((s) => s.zone === z.zone);
    const box = (z: ZoneBox) => (narrow(z) ? { x: z.x + z.w / 2 - unit / 2, w: unit } : z);
    const hit = [...zones.filter(narrow), ...zones.filter((z) => !narrow(z))].find((z) => x >= box(z).x && x <= box(z).x + box(z).w);
    if (!hit) return null;
    zone = hit.zone;
    inZone = items.filter((s) => s.zone === zone);
    // An empty zone's line is where its first item will draw: its left edge, its right edge, its centre.
    if (!inZone.length) return { zone, before: null, line: zone === "left" ? hit.x : zone === "right" ? hit.x + hit.w - 2 : hit.x + hit.w / 2 - 1 };
    at = dropSlot(inZone, x);
  } else {
    if (!items.length) return null;
    at = dropSlot(items, x);
    // Without zone boxes the room before or after the item is its own place whatever zone the neighbour is in.
    const own = items.findIndex((s) => s.id === id);
    if (own >= 0 && (at === own || at === own + 1)) return null;
    zone = (items[at] ?? items[items.length - 1]).zone;
    inZone = items.filter((s) => s.zone === zone);
    at = items[at] ? inZone.indexOf(items[at]) : inZone.length;
  }
  const before = inZone[at]?.id ?? null;
  const own = inZone.findIndex((s) => s.id === id);
  if (own >= 0 && (at === own || at === own + 1)) return null;
  const last = inZone[inZone.length - 1];
  return { zone, before, line: before === null ? last.x + last.w + gap / 2 - 1 : inZone[at].x - gap / 2 - 1 };
}

/** A pinned button drawn on the bar: its pin id and box, CSS px. */
export type PinSlot = { id: string; x: number; w: number };

/**
 * Where pin `id` dragged (or files dropped, id null) to `x` lands among the shown pinned buttons: before the first whose centre is
 * right of `x` (dropSlot), null past the last, and the left edge of the 2 px line, centred in the `gap`. Null with no pinned button
 * shown, and on the pin's own place (before itself or right after it): nothing to write. The window buttons of one pinned app side by
 * side (one button per window) are one slot, since a pin lands only before or after all of them.
 */
export function pinDrop(shown: PinSlot[], id: string | null, x: number, gap: number): { before: string | null; line: number } | null {
  const slots = pinSlots(shown);
  if (!slots.length) return null;
  const at = dropSlot(slots, x);
  const own = id === null ? -1 : slots.findIndex((s) => s.id === id);
  if (own >= 0 && (at === own || at === own + 1)) return null;
  const last = slots[slots.length - 1];
  return at < slots.length ? { before: slots[at].id, line: slots[at].x - gap / 2 - 1 } : { before: null, line: last.x + last.w + gap / 2 - 1 };
}

/** The pinned buttons as places: the window buttons of one app side by side are one, as wide as all of them. */
export function pinSlots(shown: PinSlot[]): PinSlot[] {
  const slots: PinSlot[] = [];
  for (const s of shown) {
    const l = slots[slots.length - 1];
    if (l?.id === s.id) slots[slots.length - 1] = { ...l, w: s.x + s.w - l.x };
    else slots.push(s);
  }
  return slots;
}

/**
 * `pinned` with `id` moved before `before` (to the end with null, past the pins behind "…" too); the same array when nothing changes
 * or either id is not pinned, so nothing is written.
 */
export function movePinned(pinned: Favorite[], id: string, before: string | null): Favorite[] {
  const from = pinned.findIndex((f) => f.id === id);
  if (from < 0 || before === id) return pinned;
  const rest = pinned.filter((_, i) => i !== from);
  const at = before === null ? rest.length : rest.findIndex((f) => f.id === before);
  if (at < 0 || at === from) return pinned;
  return [...rest.slice(0, at), pinned[from], ...rest.slice(at)];
}

/** `pinned` with `add` put before `before` (at the end with null, or when `before` is no longer pinned), each id once: one already pinned stays where it is. */
export function insertPinned(pinned: Favorite[], add: Favorite[], before: string | null): Favorite[] {
  const fresh = add.filter((f, i) => !pinned.some((p) => p.id === f.id) && add.findIndex((a) => a.id === f.id) === i);
  if (!fresh.length) return pinned;
  const at = before === null ? -1 : pinned.findIndex((f) => f.id === before);
  return at < 0 ? [...pinned, ...fresh] : [...pinned.slice(0, at), ...fresh, ...pinned.slice(at)];
}

/** The ids whose own pins Rust keeps at start (`taskbar.keepPins`): the bar's pinned apps and the Launcher's, which share them. */
export function keptPinIds(pinned: Favorite[], launcher: Favorite[] | null): string[] {
  return [...pinned, ...(launcher ?? [])].map((f) => f.id);
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
  /** Rust can start a new instance from its first window (a relaunch command, or an unpackaged exe). Missing reads as false. */
  spawnable?: boolean;
  /** Rust can pin it from its window: spawnable, without entries, and not asking never to be pinned. Missing reads as false. */
  pinnable?: boolean;
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
/** The tray's icons, none while Crest's tray does not run. */
export interface TrayState {
  icons: TrayIcon[];
}

/** A button on the bar: a pinned app (`pin`) with the windows it owns, or an open app that is not pinned; `pins` are the entries that start it. */
export interface BarButton {
  key: string;
  name: string;
  pin: Favorite | null;
  pins: Favorite[];
  windows: Win[];
  /** As `Group.spawnable`: from any group a pinned app owns. */
  spawnable?: boolean;
  /** As `Group.pinnable`: never for a pinned app. */
  pinnable?: boolean;
  /** A button of one window (windowButtons): its title, the app's name when the window has none. Unset on an app's button. */
  title?: string;
  /** A pinned app in a folder: the folder's id. On the bar only while it has windows, among the open apps. */
  inFolder?: string;
  /** A folder's button: its apps' buttons in the folder's order. No windows, no pins of its own. */
  folder?: { id: string; apps: BarButton[] };
}

/**
 * The pinned apps first, in their order and with their saved names, each owning every group whose first pinned entry it is; a folder
 * (`folders`, repaired and named) in the place of its first app there, with its apps' buttons in its order, and its other apps' places
 * empty. Then the groups no pinned app owns, in Rust's order, and at its first group's place an app of a folder that has windows, with
 * all of them (option A: the folder only starts apps). `spawnable` and `pinnable` are set only when true.
 */
export function barButtons(pinned: Favorite[] | null, groups: Group[], folders: Folder[] = []): BarButton[] {
  const pins = pinned ?? [];
  const ids = new Set(pins.map((f) => f.id));
  const owner = (g: Group) => g.pins.find((p) => ids.has(p.id))?.id;
  const folderOf = new Map<string, Folder>();
  for (const f of folders) for (const a of f.apps) if (!folderOf.has(a)) folderOf.set(a, f);
  const app = (f: Favorite): BarButton => {
    const owned = groups.filter((g) => owner(g) === f.id), folder = folderOf.get(f.id);
    return { key: f.id, name: f.name, pin: f, pins: [f], windows: owned.flatMap((g) => g.windows), ...(owned.some((g) => g.spawnable) && { spawnable: true }), ...(folder && { inFolder: folder.id }) };
  };
  const byId = new Map(pins.map((f) => [f.id, f]));
  const drawn = new Set<Folder>();
  const buttons: BarButton[] = [];
  for (const f of pins) {
    const folder = folderOf.get(f.id);
    if (!folder) buttons.push(app(f));
    else if (!drawn.has(folder)) {
      drawn.add(folder);
      const apps = folder.apps.flatMap((a) => (byId.has(a) ? [app(byId.get(a)!)] : []));
      buttons.push({ key: folderKey(folder.id), name: folder.name, pin: null, pins: [], windows: [], folder: { id: folder.id, apps } });
    }
  }
  const opened = new Set<string>();
  for (const g of groups) {
    const o = owner(g);
    if (o === undefined) buttons.push({ key: g.key, name: g.name, pin: null, pins: g.pins, windows: g.windows, ...(g.spawnable && { spawnable: true }), ...(g.pinnable && { pinnable: true }) });
    else if (folderOf.has(o) && !opened.has(o)) {
      opened.add(o);
      const b = app(byId.get(o)!);
      if (b.windows.length) buttons.push(b);
    }
  }
  return buttons;
}

/**
 * One button per window, for "When full" and "Never": each app's windows in the list's order, side by side where the app's button
 * was, each with the app's pins and name; a pinned app with no window keeps its button, with no title. The key ends with the window's
 * handle after a newline, which no group key or launcher id holds.
 */
export function windowButtons(buttons: BarButton[]): BarButton[] {
  return buttons.flatMap((b) => (b.windows.length ? b.windows.map((w) => ({ ...b, key: `${b.key}\n${w.id}`, windows: [w], title: w.title || b.name })) : [b]));
}

/** The app's key of a button, also on a window's button: what goes to Rust for the app. */
export const appKey = (b: BarButton) => b.key.split("\n")[0];

/** A titled button's width at icon `size`, CSS px: seven icons wide while there is room, down to four (168 to 96 at 24). */
export const labelSpan = (size: number) => ({ min: size * 4, max: size * 7 });

/** The entry that starts the app, or null for a program Crest cannot start. */
export const launchId = (b: BarButton): string | null => b.pin?.id ?? b.pins[0]?.id ?? null;

/**
 * What a click on an app does: start an entry (as administrator with `admin`), start a new instance from listed window `id`
 * (taskbar.launchWindow), bring its one window forward or minimize it, list its windows, nothing, bring window `id` forward, close
 * all its windows, or open a folder.
 */
export type Click =
  | { kind: "launch"; id: string; admin?: true }
  | { kind: "spawn"; id: number; admin?: true }
  | { kind: "toggle"; id: number }
  | { kind: "list" }
  | { kind: "none" }
  | { kind: "activate"; id: number }
  | { kind: "closeAll" }
  | { kind: "folder" };
/** The keys held with a click, and whether it came from the middle button. */
export type ClickMods = { shift?: boolean; ctrl?: boolean; middle?: boolean };

/** A new instance, as the menu's first row, Shift+click and a middle click start it: its entry, else from its first window when Rust can, else none. */
export function newInstance(b: BarButton, admin = false): Click {
  const as = admin ? { admin: true as const } : {};
  const id = launchId(b);
  if (id !== null) return { kind: "launch", id, ...as };
  return b.spawnable && b.windows.length ? { kind: "spawn", id: b.windows[0].id, ...as } : { kind: "none" };
}

/** Ctrl+click's window: the one after `active` in the app's order, round to the first; the first when none of its is in front. */
export function cycleWindow(windows: Win[], active: number | null): number | null {
  if (!windows.length) return null;
  return windows[(windows.findIndex((w) => w.id === active) + 1) % windows.length].id;
}

/**
 * A click: Shift or the middle button starts a new instance (the middle one closes the windows with `o.middle` "close"), Ctrl+Shift
 * one as administrator, Ctrl goes through the app's windows from `o.active`; otherwise start the app, bring its one window forward
 * or minimize it, or list its windows. Without windows Ctrl is a plain click. Any click on a folder opens it.
 */
export function clickAction(b: BarButton, mods: ClickMods = {}, o: { active?: number | null; middle?: "new" | "close" } = {}): Click {
  if (b.folder) return { kind: "folder" };
  if (mods.middle) return o.middle === "close" && b.windows.length ? { kind: "closeAll" } : newInstance(b);
  if (mods.shift) return newInstance(b, mods.ctrl === true);
  const next = mods.ctrl ? cycleWindow(b.windows, o.active ?? null) : null;
  if (next !== null) return { kind: "activate", id: next };
  if (b.windows.length > 1) return { kind: "list" };
  if (b.windows.length === 1) return { kind: "toggle", id: b.windows[0].id };
  const id = launchId(b);
  return id === null ? { kind: "none" } : { kind: "launch", id };
}

/** A Windows key Rust sends the bar (keys.rs Key): Win+number with its modifiers, Win+T (by 1) and Win+Shift+T (by -1), Win+B. */
export type BarKeyMods = "plain" | "shift" | "ctrl" | "ctrlShift" | "alt";
export type BarKey = { kind: "number"; n: number; mods: BarKeyMods } | { kind: "apps"; by: 1 | -1 } | { kind: "tray" } | { kind: "search" };

/** The button Win+n acts on, counting every button in the bar's order, those behind "…" too, as Windows counts its own; Win+0 is the tenth. */
export const buttonAt = (buttons: BarButton[], n: number): BarButton | undefined => buttons[n - 1];

/** What Win+n does: what a click with the same keys does (Shift, Ctrl+Shift, Ctrl); Alt opens the app's menu. */
export function numberKey(b: BarButton | undefined, mods: BarKeyMods, active: number | null): Click | { kind: "menu" } {
  if (!b) return { kind: "none" };
  if (mods === "alt") return { kind: "menu" };
  return clickAction(b, { shift: mods === "shift" || mods === "ctrlShift", ctrl: mods === "ctrl" || mods === "ctrlShift" }, { active });
}

/** Win+T among `count` app buttons from `at` (-1: none focused): the first (by 1) or the last (by -1), then round. */
export const cycleKey = (at: number, count: number, by: 1 | -1): number => (at < 0 ? (by > 0 ? 0 : count - 1) : (at + by + count) % count);

/** The bar's arrows among `count` buttons from `at`: Left and Up step back, Right and Down on, Home and End go to the ends; no wrap; undefined for other keys or none. */
export function barArrow(key: string, at: number, count: number): number | undefined {
  if (count <= 0) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const by = key === "ArrowLeft" || key === "ArrowUp" ? -1 : key === "ArrowRight" || key === "ArrowDown" ? 1 : 0;
  return by ? Math.min(count - 1, Math.max(0, at + by)) : undefined;
}

/** What a screen reader hears after an app's name (N1), in this order: pinned, one window or several open, in front, asking for attention. */
export type AppState = "pinned" | "one" | "many" | "front" | "attention";
export function appState(b: BarButton, active: number | null): AppState[] {
  const n = b.windows.length;
  return [
    ...(b.pin ? (["pinned"] as const) : []),
    ...(n === 1 ? (["one"] as const) : n > 1 ? (["many"] as const) : []),
    ...(b.windows.some((w) => w.id === active) ? (["front"] as const) : []),
    ...(b.windows.some((w) => w.flashing) ? (["attention"] as const) : []),
  ];
}

/** The mark under a button: a window asks for attention, one is in front, some are open, or none. */
export type Indicator = "attention" | "front" | "open" | "none";

/** With `flashing` off an app asking for attention shows as any other. */
export function indicator(b: BarButton, active: number | null, flashing = true): Indicator {
  if (flashing && b.windows.some((w) => w.flashing)) return "attention";
  if (b.windows.some((w) => w.id === active)) return "front";
  return b.windows.length ? "open" : "none";
}

/** The count on an app's icon: none under two windows, "9+" past nine. */
export const windowBadge = (n: number): string | null => (n < 2 ? null : n > 9 ? "9+" : String(n));

/** A mouse's wheel notch in deltaY, and the volume one notch moves, in percent. */
export const WHEEL_NOTCH = 100;
export const WHEEL_STEP = 2;

/** Whole notches in `rest` plus `deltaY`, up the wheel being louder, and what is left over: a touchpad's small deltas add up to one. */
export function wheelSteps(rest: number, deltaY: number): { steps: number; rest: number } {
  const total = rest - deltaY;
  const steps = Math.trunc(total / WHEEL_NOTCH) || 0; // never -0
  return { steps, rest: total - steps * WHEEL_NOTCH };
}

/** The count on the clock: none at 0, "99+" past 99. */
export const countBadge = (n: number | null): string | null => (!n ? null : n > 99 ? "99+" : String(n));

/** How long a file held over an app waits before its window comes forward, ms. */
export const DRAG_REST = 600;

/** The right-click menu's entries, in order. */
export type MenuEntry = "launch" | "pin" | "unpin" | "move" | "out" | "reveal" | "endTask" | "close" | "closeAll";

/**
 * Windows' order: the app's name (a new instance) when newInstance has one; Unpin for a pinned app, then Move to folder, and Remove
 * from folder for one in a folder; Pin with an entry or a pinnable window; Open file location for an open app Rust can start from its
 * window; End task with the switch on and a window open; Close for one window, Close all for more.
 */
export function menuFor(b: BarButton, o: { endTask: boolean } = { endTask: false }): MenuEntry[] {
  const entries: MenuEntry[] = [];
  if (newInstance(b).kind !== "none") entries.push("launch");
  if (b.pin) entries.push("unpin", "move", ...(b.inFolder ? (["out"] as const) : []));
  else if (b.pins.length || b.pinnable) entries.push("pin");
  if (b.windows.length && b.spawnable) entries.push("reveal");
  if (b.windows.length && o.endTask) entries.push("endTask");
  if (b.windows.length === 1) entries.push("close");
  else if (b.windows.length > 1) entries.push("closeAll");
  return entries;
}

/** What Rust sends for an app's jump list (src-tauri/src/taskbar/jumplist.rs): rows by group, each opened by `token` and `id`. */
export type JumpKind = "frequent" | "recent" | "custom" | "tasks";
export interface JumpItem {
  id: number;
  title: string;
  icon: string | null;
  separator: boolean;
}
/** `title` is the app's own name for a custom category, untranslated; empty for the others. */
export interface JumpGroup {
  kind: JumpKind;
  title: string;
  items: JumpItem[];
}
export interface JumpList {
  token: number;
  groups: JumpGroup[];
}

const JUMP_HEADINGS: Record<Exclude<JumpKind, "custom">, string> = { frequent: "Häufig verwendet", recent: "Zuletzt verwendet", tasks: "Aufgaben" };
/** A group's heading: Windows' words through t() (`key`), or the app's own words as they are (`text`). */
export const jumpHeading = (g: JumpGroup): { key: string } | { text: string } => (g.kind === "custom" ? { text: g.title } : { key: JUMP_HEADINGS[g.kind] });

/** The left edge of a menu centred over its anchor and kept `edge` px inside the window; a menu wider than the window starts at the left edge. */
export const placeMenu = (anchorX: number, anchorW: number, menuW: number, viewW: number, edge = 8) =>
  Math.max(edge, Math.min(anchorX + anchorW / 2 - menuW / 2, viewW - edge - menuW));

/** How an app's window previews lay out: a thumbnail box per window of `w` x `h` CSS px, or their titles as a list. */
export type PreviewLayout = { kind: "tiles"; w: number; h: number } | { kind: "list" };

/**
 * 192 x 120 boxes (16:10), narrower so `count` of them fit the window less 8 px each side, the menu panel's 4 px padding, 4 px
 * between tiles and 6 px inside each; the list once a box would fall under 120 px wide, or with no window.
 */
export function previewLayout(count: number, viewW: number): PreviewLayout {
  if (count < 1) return { kind: "list" };
  const w = Math.min(192, Math.floor((viewW - 16 - 8 - (count - 1) * 4) / count) - 12);
  return w < 120 ? { kind: "list" } : { kind: "tiles", w, h: Math.round((w * 120) / 192) };
}

/** An app with several windows whose thumbnails all failed lists their titles instead; one window, or only some failing, keep the icon in the box. */
export const previewFallsBack = (answers: readonly unknown[], count: number): boolean => count > 1 && answers.length > 0 && answers.every((a) => a === null);

/** What a preview card sends its boxes again on: its windows in order and which are minimized, since Rust draws no thumbnail for those. */
export const previewSet = (windows: readonly Win[]): string => windows.map((w) => `${w.id}${w.minimized ? "m" : ""}`).join();

/** The row a key moves to among a menu's `count` rows from row `at` (-1: none): Up and Down wrap, Home and End go to the ends; undefined for any other key. */
export function menuKey(key: string, at: number, count: number): number | undefined {
  const to = key === "ArrowDown" ? at + 1 : key === "ArrowUp" ? (at < 0 ? count : at) - 1 : key === "Home" ? 0 : key === "End" ? count - 1 : undefined;
  return to === undefined || !count ? undefined : (to + count) % count;
}

/** The preview card's tiles run along the bar: Right and Left step as menuKey's Down and Up (mirrored right to left); other keys pass as they are. */
export const previewKey = (key: string, rtl: boolean): string =>
  key === "ArrowRight" ? (rtl ? "ArrowUp" : "ArrowDown") : key === "ArrowLeft" ? (rtl ? "ArrowDown" : "ArrowUp") : key;

/**
 * The Taskbar settings show in the Windows app only: in a dev build, in a build that offers the bar (not the Store one), and while the
 * bar is on, so it can be turned off. In the browser, only the site's full-screen demo, which offers a bar of its own (src/dev/demoBar.tsx).
 */
export const taskbarShown = (p: { native: boolean; mac: boolean; dev: boolean; offered: boolean; enabled: boolean; demo: boolean }): boolean =>
  p.demo || (p.native && !p.mac && (p.dev || p.offered || p.enabled));

/** A window's state for its menu (Shift+right-click), as Rust reads it (tasks.rs `taskbar_window_menu`). */
export type WindowState = { minimized: boolean; maximized: boolean; canMinimize: boolean; canMaximize: boolean; canSize: boolean };
export type WindowEntry = "restore" | "move" | "size" | "minimize" | "maximize" | "close";

/** The window menu's rows, each enabled as Windows' own system menu enables it; before the state comes, only Close. */
export function windowMenuRows(s: WindowState | null): { entry: WindowEntry; enabled: boolean }[] {
  const normal = !!s && !s.minimized && !s.maximized;
  return [
    { entry: "restore", enabled: !!s && (s.minimized || s.maximized) },
    { entry: "move", enabled: normal },
    { entry: "size", enabled: normal && s.canSize },
    { entry: "minimize", enabled: !!s && s.canMinimize && !s.minimized },
    { entry: "maximize", enabled: !!s && s.canMaximize && !s.maximized },
    { entry: "close", enabled: true },
  ];
}

export type GroupEntry = "cascade" | "stack" | "side" | "restoreAll" | "minimizeAll" | "closeAll";
/** The group menu of an app with several windows, in Windows' order. */
export const GROUP_MENU: readonly GroupEntry[] = ["cascade", "stack", "side", "restoreAll", "minimizeAll", "closeAll"];

/** What Shift+right-click on an app opens: its window's menu with one window, the group's with several, its usual menu with none; a folder's own. */
export const shiftMenu = (b: BarButton): "window" | "group" | "app" | "folder" => (b.folder ? "folder" : b.windows.length === 1 ? "window" : b.windows.length ? "group" : "app");

/** Where a preview dragged from tile `from` lands among the tiles (`slots`, in reading order) at `x`: null on its own place or the one after it. */
export function previewDrop(slots: { x: number; w: number }[], from: number, x: number): number | null {
  const at = dropSlot(slots, x);
  return at === from || at === from + 1 ? null : at;
}

/** `ids` with the one at `from` put before the one at `at` (indexes in `ids` as it is; `ids.length` puts it last). */
export function movedOrder(ids: number[], from: number, at: number): number[] {
  const rest = ids.filter((_, i) => i !== from);
  rest.splice(at > from ? at - 1 : at, 0, ids[from]);
  return rest;
}
