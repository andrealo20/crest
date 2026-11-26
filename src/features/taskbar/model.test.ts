import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stockSymbol,
  jumpHeading,
  GROUP_MENU,
  movedOrder,
  previewDrop,
  recycleName,
  emptyWarning,
  shiftMenu,
  windowMenuRows,
  COMPACT_PAD,
  CRYPTO_COINS,
  START_ICONS,
  TASKBAR_DEFAULTS,
  TOOL_BUTTONS,
  WIDGET_VARIANTS,
  appKey,
  applyWindowsPins,
  appState,
  barArrow,
  barButtons,
  buttonAt,
  cycleKey,
  keysWanted,
  numberKey,
  clickAction,
  compactIcon,
  countBadge,
  cycleWindow,
  wheelSteps,
  dropPlace,
  fitIcon,
  indicator,
  insertPinned,
  keptPinIds,
  labelSpan,
  menuFor,
  menuKey,
  newInstance,
  moveBefore,
  moveItem,
  movePinned,
  normalizeTaskbar,
  normalizeZones,
  pinDrop,
  pinSlots,
  placeMenu,
  previewFallsBack,
  previewKey,
  previewLayout,
  previewSet,
  micWanted,
  statusWanted,
  stepFocus,
  stepItem,
  taskbarShown,
  trayIcon,
  trayOnBar,
  batteryOnBar,
  trayWanted,
  variantOf,
  windowBadge,
  windowButtons,
  type BarButton,
  type BarItem,
  type Group,
  type Win,
  type Zone,
} from "./model.ts";
import { WHATSAPP } from "./unread.ts";

test("any saved value becomes valid bar settings", () => {
  for (const v of [undefined, null, 0, "x", [], true, { zones: "x", height: "44", surface: 1, pinned: {}, clock: "x" }]) assert.deepEqual(normalizeTaskbar(v), TASKBAR_DEFAULTS);
  assert.equal(normalizeTaskbar({ enabled: "yes" }).enabled, false);
  assert.equal(normalizeTaskbar({ enabled: true }).enabled, true);
  assert.equal(normalizeTaskbar({ autoHide: true }).autoHide, true);
  assert.equal(normalizeTaskbar({ autoHide: "yes" }).autoHide, false);
  // On unless switched off: settings saved before the switch keep the percentage they had.
  assert.equal(normalizeTaskbar({}).batteryPercent, true);
  assert.equal(normalizeTaskbar({ batteryPercent: false }).batteryPercent, false);
  assert.equal(normalizeTaskbar({ endTask: true }).endTask, true);
  assert.equal(normalizeTaskbar({ endTask: "yes" }).endTask, false);
  assert.equal(normalizeTaskbar({ height: 100 }).height, 64);
  assert.equal(normalizeTaskbar({ height: -5 }).height, 32);
  assert.equal(normalizeTaskbar({ height: 40, iconSize: 40 }).iconSize, 40); // fitIcon shrinks it where it is drawn, not in the saved setting
  assert.equal(fitIcon(40, 40), 28);
  assert.equal(normalizeTaskbar({ surface: "glass" }).surface, "notch");
  assert.deepEqual(normalizeTaskbar({ pinned: [{ id: "a", name: "A" }, { id: "a", name: "B" }, { id: 1 }] }).pinned, [{ id: "a", name: "A" }]);
  normalizeTaskbar(undefined).zones.left.push("crest");
  assert.deepEqual(TASKBAR_DEFAULTS.zones.left, []);
});

test("tray icons are two thirds of the apps' icons", () => {
  assert.equal(trayIcon(24), 16);
  assert.equal(trayIcon(16), 11);
  assert.equal(trayIcon(40), 27);
});

test("narrow apps keep five sixths of the icon and 10 px round it", () => {
  assert.equal(compactIcon(24), 20);
  assert.equal(compactIcon(16), 13);
  assert.equal(compactIcon(40), 33);
  assert.equal(compactIcon(24) + COMPACT_PAD, 30);
});

test("the look's settings are repaired and default to today's bar", () => {
  const d = normalizeTaskbar(undefined);
  assert.deepEqual([d.shape, d.transparency, d.glass, d.glassLook], ["floating", 0, false, "crest"]);
  const s = normalizeTaskbar({ shape: "tiles", transparency: 37.6, glass: true, glassLook: "plus" });
  assert.deepEqual([s.shape, s.transparency, s.glass, s.glassLook], ["tiles", 38, true, "plus"]);
  const bad = normalizeTaskbar({ shape: "dock", transparency: 400, glass: "yes", glassLook: "Plus" });
  assert.deepEqual([bad.shape, bad.transparency, bad.glass, bad.glassLook], ["floating", 100, false, "crest"]);
  assert.equal(normalizeTaskbar({ transparency: -5 }).transparency, 0);
  // The widgets' size against the icons', percent: 100, today's, unless set.
  assert.equal(d.widgetSize, 100);
  assert.equal(normalizeTaskbar({ widgetSize: 85 }).widgetSize, 85);
  assert.equal(normalizeTaskbar({ widgetSize: 200 }).widgetSize, 125);
  assert.equal(normalizeTaskbar({ widgetSize: 10 }).widgetSize, 75);
  assert.equal(normalizeTaskbar({ widgetSize: "90" }).widgetSize, 100);
  // The look outlives Glass switched off, so switching it back on brings the same look.
  assert.equal(normalizeTaskbar({ glass: false, glassLook: "plus" }).glassLook, "plus");
});

test("every fixed item sits in exactly one zone", () => {
  assert.deepEqual(normalizeZones({}), { left: [], center: ["start", "apps"], right: [] });
  assert.deepEqual(normalizeZones({ left: ["crest", "x"], center: ["apps", "crest"] }), { left: ["crest"], center: ["start", "apps"], right: [] });
  assert.deepEqual(normalizeZones({ right: ["start"] }), { left: [], center: ["apps"], right: ["start"] }); // a missing item returns at its default index, here past the end
});

test("the Crest button comes off the bar and stays off, and a bar that has it keeps it where it is", () => {
  const off: Record<Zone, BarItem[]> = { left: [], center: ["start", "apps"], right: ["clock"] };
  assert.deepEqual(normalizeZones(off), off);
  assert.deepEqual(normalizeTaskbar({ zones: off, widgetsSeeded: true, traySeeded: true, statusSeeded: true }).zones, off);
  // Every bar saved before it could come off has it, wherever it was moved.
  assert.deepEqual(normalizeZones({ left: ["crest"], center: ["start", "apps"], right: ["clock"] }).left, ["crest"]);
  // A new bar, and one saved before the widgets, get it at the end of the right zone.
  assert.equal(normalizeTaskbar(undefined).zones.right.at(-1), "crest");
  assert.deepEqual(normalizeZones({ left: [], center: ["start", "apps"], right: [] }, true).right, ["weather", "clock", "crest"]);
});

test("the Start button comes first in the middle, also on a bar saved before it existed", () => {
  assert.deepEqual(TASKBAR_DEFAULTS.zones.center, ["start", "apps"]);
  assert.deepEqual(normalizeZones({ left: [], center: ["apps"], right: ["crest"] }).center, ["start", "apps"]); // a phase 2 save
});

test("widgets stay where they were put, and a missing one stays off the bar", () => {
  assert.deepEqual(normalizeZones({ left: ["timer", "x"], center: ["start", "apps"], right: ["timer", "clock", "crest"] }), { left: ["timer"], center: ["start", "apps"], right: ["clock", "crest"] });
});

test("the default widgets arrive once", () => {
  assert.deepEqual(normalizeZones(undefined, true), { ...TASKBAR_DEFAULTS.zones, right: ["weather", "clock", "crest"] }); // the tray arrives with normalizeTaskbar
  assert.deepEqual(normalizeZones({ left: [], center: ["apps"], right: ["crest"] }, true).right, ["weather", "clock", "crest"]);
  assert.deepEqual(normalizeZones({ left: ["clock"], center: ["apps"], right: ["crest"] }, true), { left: ["clock"], center: ["start", "apps"], right: ["weather", "crest"] });
  const once = normalizeTaskbar({ zones: { left: [], center: ["apps"], right: ["crest"] } });
  assert.deepEqual(once.zones.right, ["weather", "tray", "status", "clock", "crest"]);
  assert.equal(once.widgetsSeeded, true);
  assert.deepEqual(normalizeTaskbar({ ...once, zones: { ...once.zones, right: ["crest"] } }).zones.right, ["crest"]);
  assert.deepEqual(normalizeTaskbar(undefined).zones, TASKBAR_DEFAULTS.zones);
});

test("the bar's clock has its own date and seconds", () => {
  assert.deepEqual(normalizeTaskbar({}).clock, { date: true, seconds: false });
  assert.deepEqual(normalizeTaskbar({ clock: { date: false, seconds: "x" } }).clock, { date: false, seconds: false });
});

test("each widget with versions starts on today's look", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(WIDGET_VARIANTS).map(([id, v]) => [id, v[0]])), { weather: "temp", clock: "digital", readings: "dials", timer: "countdown", disk: "system", title: "text", processes: "cpu", battery: "ring", mic: "mic", progress: "day", date: "fulldate", world: "world", temps: "history", bluetooth: "lowest", keepawake: "icon", unread: "badge", screentime: "total", timeline: "fullday", wallpaper: "thumb", crypto: "coin" });
  assert.deepEqual(TASKBAR_DEFAULTS.variants, {});
});

test("the crypto widget shows a coin, a stock by its Yahoo Finance symbol or the Depot, and keeps only a symbol Yahoo could know", () => {
  assert.deepEqual(normalizeTaskbar({ variants: { crypto: "stock" } }).variants, { crypto: "stock" });
  assert.deepEqual(normalizeTaskbar({ variants: { crypto: "bond" } }).variants, {});
  assert.equal(stockSymbol(" vwce.de "), "VWCE.DE");
  for (const ok of ["AAPL", "BRK-B", "^GSPC", "EURUSD=X", "ENI.MI"]) assert.equal(stockSymbol(ok), ok);
  for (const bad of ["", "...", "A B", "AAPL/X", "ÄPPL", "ABCDEFGHIJKLMNOP", 42, null]) assert.equal(stockSymbol(bad), null, String(bad));
  assert.equal(normalizeTaskbar({}).stock, "AAPL");
  assert.equal(normalizeTaskbar({ stock: "msft" }).stock, "MSFT");
  assert.equal(normalizeTaskbar({ stock: "a b" }).stock, "AAPL");
  // Its range: today unless a week, a month or a year was picked.
  assert.equal(normalizeTaskbar({}).marketRange, "1d");
  assert.equal(normalizeTaskbar({ marketRange: "1y" }).marketRange, "1y");
  assert.equal(normalizeTaskbar({ marketRange: "5y" }).marketRange, "1d");
});

test("the second group's versions are kept as saved, anything else dropped", () => {
  const all = { temps: "fans", bluetooth: "devices", keepawake: "left", unread: "each", screentime: "hourly", timeline: "ahead", wallpaper: "keys" };
  assert.deepEqual(normalizeTaskbar({ variants: all }).variants, all);
  // Unread's second version is `each`: `apps` is Screen Time's, and VARIANT_LABEL names a version once for every widget.
  assert.deepEqual(normalizeTaskbar({ variants: { unread: "apps", wallpaper: "big", keepawake: "x", screentime: "apps" } }).variants, { screentime: "apps" });
  assert.equal(variantOf(undefined, "unread"), "badge");
  assert.equal(variantOf({}, "wallpaper"), "thumb");
});

test("the Unread widget counts WhatsApp until another pick, and a list emptied stays empty", () => {
  assert.deepEqual(TASKBAR_DEFAULTS.unread, [WHATSAPP]);
  assert.deepEqual(normalizeTaskbar({}).unread, [WHATSAPP]);
  assert.deepEqual(normalizeTaskbar({ unread: [] }).unread, []);
  assert.deepEqual(normalizeTaskbar({ unread: ["A", "b"] }).unread, ["a", "b"]);
});

test("folders hold pinned apps only, and none before any app is pinned", () => {
  assert.deepEqual(TASKBAR_DEFAULTS.folders, []);
  assert.deepEqual(normalizeTaskbar({ folders: [{ id: "f", name: "Work", apps: ["a"] }] }).folders, []);
  const pinned = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
  assert.deepEqual(normalizeTaskbar({ pinned, folders: [{ id: "f", name: "Work", apps: ["b", "x"] }] }).folders, [{ id: "f", name: "Work", apps: ["b"] }]);
});

test("a saved version is kept only for a widget that has it, and anything else is dropped", () => {
  assert.deepEqual(normalizeTaskbar({ variants: { weather: "hours", clock: "nope", readings: 3, title: "x", bogus: "line", timer: "ring" } }).variants, { weather: "hours", timer: "ring" });
  for (const v of [undefined, null, "x", [], 1]) assert.deepEqual(normalizeTaskbar({ variants: v }).variants, {});
  assert.deepEqual(normalizeTaskbar({ variants: { clock: "analog" }, clock: { date: false } }).clock, { date: false, seconds: false });
  const all = { readings: "net", title: "disc", processes: "ram", battery: "gauge", mic: "both", progress: "year", clock: "segment", weather: "sun", date: "week", world: "cities" };
  assert.deepEqual(normalizeTaskbar({ variants: all }).variants, all);
  // The date and the cities left the clock for widgets of their own: saved on the clock they are dropped.
  assert.deepEqual(normalizeTaskbar({ variants: { processes: "ring", battery: "cpu", progress: "hours", mic: "x", clock: "week", date: "cities", world: "fulldate" } }).variants, {});
});

test("a widget draws its saved version, today's look for one it does not know, as another window may send raw JSON", () => {
  assert.equal(variantOf({ weather: "hours" }, "weather"), "hours");
  assert.equal(variantOf({ weather: "zzz" }, "weather"), "temp");
  assert.equal(variantOf({ readings: "line" }, "clock"), "digital");
  for (const v of [undefined, null, "x", [], { clock: 1 }, JSON.parse('{"__proto__":{"clock":"analog"}}')]) assert.equal(variantOf(v, "clock"), "digital");
});

test("items move between zones", () => {
  const z = normalizeZones({ right: ["crest"] });
  assert.deepEqual(moveItem(z, "crest", "left"), { left: ["crest"], center: ["start", "apps"], right: [] });
  assert.deepEqual(moveItem(normalizeZones({ center: ["apps", "crest"] }), "crest", "center", 0).center, ["crest", "start", "apps"]);
  assert.deepEqual(moveItem(z, "crest", "left", 99).left, ["crest"]);
  assert.equal(moveItem(z, "nope" as BarItem, "left"), z);
});

test("pinned apps come first and own their open windows", () => {
  const w = (id: number): Win => ({ id, title: "t", minimized: false, flashing: false });
  const code = { id: "shell:AppsFolder\\VSCode", name: "VS Code" }, paths = { id: "C:\\Users\\u\\Code.exe", name: "Code" };
  const groups: Group[] = [
    { key: "chrome", name: "Chrome", pins: [{ id: "shell:AppsFolder\\Chrome", name: "Chrome" }], windows: [w(1)] },
    { key: "c:\\users\\u\\code.exe", name: "VS Code", pins: [code, paths], windows: [w(2), w(3)] },
    { key: "window:9", name: "tool", pins: [], windows: [w(9)] },
  ];
  const b = barButtons([paths, code, { id: "shell:AppsFolder\\Notepad", name: "Notepad" }], groups);
  assert.deepEqual(b.map((x) => x.key), [paths.id, code.id, "shell:AppsFolder\\Notepad", "chrome", "window:9"]);
  assert.deepEqual(b[1].windows.map((x) => x.id), [2, 3]); // the first pinned id in group.pins owns it
  assert.equal(b[0].windows.length, 0);
  assert.equal(b[2].windows.length, 0); // pinned and closed
  assert.deepEqual(barButtons(null, groups).map((x) => x.key), ["chrome", "c:\\users\\u\\code.exe", "window:9"]);
});

test("Windows' buttons stay where they were put, once each, and an unknown one is dropped", () => {
  const z = normalizeZones({ left: ["sys:search", "sys:nope"], center: ["start", "apps", "sys:search"], right: ["sys:desktop", "crest"] });
  assert.deepEqual(z, { left: ["sys:search"], center: ["start", "apps"], right: ["sys:desktop", "crest"] });
  assert.equal(Object.values(TASKBAR_DEFAULTS.zones).flat().some((id) => id.startsWith("sys:")), false); // opt-in: an update adds none
});

test("a double click on the empty bar does nothing at first, and junk is repaired", () => {
  assert.equal(normalizeTaskbar({}).emptyDouble, "none");
  assert.deepEqual([normalizeTaskbar({}).flashing, normalizeTaskbar({}).middleClick, normalizeTaskbar({}).windowCount], [true, "new", false]);
  assert.deepEqual([normalizeTaskbar({ flashing: false }).flashing, normalizeTaskbar({ middleClick: "close" }).middleClick, normalizeTaskbar({ windowCount: true }).windowCount], [false, "close", true]);
  assert.deepEqual([normalizeTaskbar({ flashing: 0 }).flashing, normalizeTaskbar({ middleClick: "x" }).middleClick, normalizeTaskbar({ windowCount: 1 }).windowCount], [true, "new", false]);
  for (const v of ["desktop", "taskmgr"]) assert.equal(normalizeTaskbar({ emptyDouble: v }).emptyDouble, v);
  for (const v of ["x", 1, null, true]) assert.equal(normalizeTaskbar({ emptyDouble: v }).emptyDouble, "none");
});

test("the combine setting is repaired and defaults to one button per app", () => {
  assert.equal(normalizeTaskbar({}).combine, "always");
  for (const c of ["never", "full"]) assert.equal(normalizeTaskbar({ combine: c }).combine, c);
  for (const c of ["x", 1, null]) assert.equal(normalizeTaskbar({ combine: c }).combine, "always");
});

test("one button per window keeps the app's place, pins and name", () => {
  const w = (id: number, title: string): Win => ({ id, title, minimized: false, flashing: false });
  const pin = { id: "pin", name: "App" }, idle = { id: "idle", name: "Idle" };
  const groups: Group[] = [
    { key: "app", name: "App", pins: [pin], windows: [w(1, "Doc A"), w(2, "")] },
    { key: "group", name: "Group", pins: [], windows: [w(3, "Group title")] },
  ];
  const apps = barButtons([pin, idle], groups);
  const b = windowButtons(apps);
  assert.deepEqual(b.map((x) => x.key), ["pin\n1", "pin\n2", "idle", "group\n3"]);
  assert.deepEqual(b.map((x) => x.windows.map((v) => v.id)), [[1], [2], [], [3]]);
  assert.deepEqual(b.map((x) => x.title), ["Doc A", "App", undefined, "Group title"]);
  for (const x of b.slice(0, 2)) assert.deepEqual([x.pin, x.pins, x.name], [pin, [pin], "App"]);
  assert.deepEqual(b[2], apps[1]); // a pinned app with no window, unchanged and untitled
  assert.equal("title" in b[2], false);
  assert.deepEqual([b[3].pin, b[3].pins, b[3].name], [null, [], "Group"]);
});

test("a window's button clicks, marks and menus as an app with one window", () => {
  const w = (id: number, flashing = false): Win => ({ id, title: "t", minimized: false, flashing });
  const pin = { id: "pin", name: "App" };
  const [one, two] = windowButtons(barButtons([pin], [{ key: "app", name: "App", pins: [pin], windows: [w(1), w(2, true)] }]));
  assert.deepEqual(clickAction(one), { kind: "toggle", id: 1 });
  assert.deepEqual(clickAction(two), { kind: "toggle", id: 2 });
  for (const b of [one, two]) assert.deepEqual(menuFor(b, { endTask: false }), ["launch", "unpin", "move", "close"]);
  assert.equal(indicator(one, null), "open");
  assert.equal(indicator(two, null), "attention");
});

test("a titled button is four to seven icons wide", () => {
  assert.deepEqual(labelSpan(24), { min: 96, max: 168 });
});

test("a window's button sends its app's key", () => {
  const pin = { id: "pin", name: "App" };
  const apps = barButtons([pin], [{ key: "app", name: "App", pins: [pin], windows: [{ id: 5, title: "t", minimized: false, flashing: false }] }]);
  assert.equal(appKey(apps[0]), "pin");
  assert.equal(appKey(windowButtons(apps)[0]), "pin");
});

test("an open app is pinnable and spawnable as Rust says, a pinned one never pinnable", () => {
  const w = (id: number): Win => ({ id, title: "t", minimized: false, flashing: false });
  const chrome = { id: "shell:AppsFolder\\Chrome", name: "Chrome" };
  const groups: Group[] = [
    { key: "chrome", name: "Chrome", pins: [chrome], windows: [w(1)] },
    { key: "chrome.work", name: "Work", pins: [chrome], windows: [w(2)], spawnable: true, pinnable: false },
    { key: "c:\\tools\\tool.exe", name: "Tool", pins: [], windows: [w(3)], spawnable: true, pinnable: true },
    { key: "window:4", name: "x", pins: [], windows: [w(4)], spawnable: false, pinnable: false },
  ];
  const [pinned, tool, plain] = barButtons([chrome], groups);
  assert.equal(pinned.spawnable, true); // from the second group it owns
  assert.equal(pinned.pinnable, undefined);
  assert.equal(tool.spawnable, true);
  assert.equal(tool.pinnable, true);
  assert.equal("spawnable" in plain || "pinnable" in plain, false); // set only when true
  assert.equal(barButtons([chrome], groups.slice(0, 1))[0].spawnable, undefined);
});

test("a click launches, toggles or lists", () => {
  const w = (id: number, flashing = false): Win => ({ id, title: "t", minimized: false, flashing });
  const base = { key: "k", name: "n", pin: null, pins: [{ id: "x", name: "X" }] } satisfies Omit<BarButton, "windows">;
  assert.deepEqual(clickAction({ ...base, windows: [] }), { kind: "launch", id: "x" });
  assert.deepEqual(clickAction({ ...base, pins: [], windows: [] }), { kind: "none" });
  assert.deepEqual(clickAction({ ...base, windows: [w(4)] }), { kind: "toggle", id: 4 });
  assert.deepEqual(clickAction({ ...base, windows: [w(4), w(5)] }), { kind: "list" });
  assert.equal(indicator({ ...base, windows: [w(4, true)] }, 4), "attention");
  assert.equal(indicator({ ...base, windows: [w(4)] }, 4), "front");
  assert.equal(indicator({ ...base, windows: [w(4)] }, 7), "open");
  assert.equal(indicator({ ...base, windows: [] }, null), "none");
  assert.equal(indicator({ ...base, windows: [w(4, true)] }, 4, false), "front");
  assert.equal(indicator({ ...base, windows: [w(4, true)] }, null, false), "open");
});

test("Ctrl+click goes round an app's windows, and the count shows from two", () => {
  const w = (id: number): Win => ({ id, title: "t", minimized: false, flashing: false });
  const three = [w(1), w(2), w(3)];
  assert.equal(cycleWindow(three, 1), 2);
  assert.equal(cycleWindow(three, 3), 1);
  assert.equal(cycleWindow(three, 9), 1);
  assert.equal(cycleWindow(three, null), 1);
  assert.equal(cycleWindow([], 1), null);
  assert.deepEqual([1, 2, 9, 10].map(windowBadge), [null, "2", "9", "9+"]);
  assert.deepEqual([null, 0, 99, 100].map(countBadge), [null, null, "99", "99+"]);
});

test("the wheel moves the volume by whole notches, keeping what is left", () => {
  assert.deepEqual(wheelSteps(0, -100), { steps: 1, rest: 0 });
  assert.deepEqual(wheelSteps(0, 300), { steps: -3, rest: 0 });
  let r = { steps: 0, rest: 0 };
  for (const d of [-40, -40]) r = wheelSteps(r.rest, d);
  assert.deepEqual(r, { steps: 0, rest: 80 });
  assert.deepEqual(wheelSteps(r.rest, -40), { steps: 1, rest: 20 });
  // Turned back, the rest goes down before a step the other way.
  assert.deepEqual(wheelSteps(20, 60), { steps: 0, rest: -40 });
  assert.equal(normalizeTaskbar({}).wheelVolume, false);
  assert.equal(normalizeTaskbar({ wheelVolume: true }).wheelVolume, true);
});

test("the displays' settings keep today's bars until changed", () => {
  const d = normalizeTaskbar({});
  assert.deepEqual([d.allScreens, d.appsOn, d.clockAll], [true, "own", false]);
  const set = normalizeTaskbar({ allScreens: false, appsOn: "main", clockAll: true });
  assert.deepEqual([set.allScreens, set.appsOn, set.clockAll], [false, "main", true]);
  const junk = normalizeTaskbar({ allScreens: 0, appsOn: "x", clockAll: "yes" });
  assert.deepEqual([junk.allScreens, junk.appsOn, junk.clockAll], [true, "own", false]);
});

test("Shift, the middle button and Ctrl+Shift start a new instance", () => {
  const w = (id: number): Win => ({ id, title: "t", minimized: false, flashing: false });
  const entry = { key: "k", name: "n", pin: null, pins: [{ id: "x", name: "X" }], windows: [w(4)] } satisfies BarButton;
  const own = { key: "c:\\tools\\tool.exe", name: "Tool", pin: null, pins: [], windows: [w(7), w(8)], spawnable: true } satisfies BarButton;
  const plain = { key: "window:9", name: "x", pin: null, pins: [], windows: [w(9)] } satisfies BarButton;
  for (const mods of [{ shift: true }, { middle: true }]) {
    assert.deepEqual(clickAction(entry, mods), { kind: "launch", id: "x" });
    assert.deepEqual(clickAction(own, mods), { kind: "spawn", id: 7 });
    assert.deepEqual(clickAction(plain, mods), { kind: "none" });
  }
  assert.deepEqual(clickAction(entry, { shift: true, ctrl: true }), { kind: "launch", id: "x", admin: true });
  assert.deepEqual(clickAction(own, { shift: true, ctrl: true }), { kind: "spawn", id: 7, admin: true });
  // Ctrl alone goes to the window after the one in front; without windows it is a plain click.
  assert.deepEqual(clickAction(entry, { ctrl: true }), { kind: "activate", id: 4 });
  assert.deepEqual(clickAction(own, { ctrl: true }, { active: 7 }), { kind: "activate", id: 8 });
  assert.deepEqual(clickAction({ ...entry, windows: [] }, { ctrl: true }), { kind: "launch", id: "x" });
  assert.deepEqual(clickAction(own), { kind: "list" });
  // The middle button with "close" closes an app's windows, and starts one as before without any.
  assert.deepEqual(clickAction(own, { middle: true }, { middle: "close" }), { kind: "closeAll" });
  assert.deepEqual(clickAction(entry, { middle: true }, { middle: "close" }), { kind: "closeAll" });
  assert.deepEqual(clickAction({ ...entry, windows: [] }, { middle: true }, { middle: "close" }), { kind: "launch", id: "x" });
  assert.deepEqual(newInstance({ ...own, spawnable: false }), { kind: "none" });
  assert.deepEqual(newInstance({ ...own, windows: [] }), { kind: "none" });
});

test("the right-click menu offers what the app allows, in Windows' order", () => {
  const w = (id: number): Win => ({ id, title: "t", minimized: false, flashing: false });
  const pin = { id: "p", name: "P" };
  assert.deepEqual(menuFor({ key: "p", name: "P", pin, pins: [pin], windows: [] }), ["launch", "unpin", "move"]);
  assert.deepEqual(menuFor({ key: "k", name: "K", pin: null, pins: [pin], windows: [w(1)] }), ["launch", "pin", "close"]);
  assert.deepEqual(menuFor({ key: "k", name: "K", pin: null, pins: [], windows: [w(1), w(2)] }), ["closeAll"]);
  const own = { key: "c:\\tools\\tool.exe", name: "Tool", pin: null, pins: [], windows: [w(1)], spawnable: true, pinnable: true } satisfies BarButton;
  assert.deepEqual(menuFor(own), ["launch", "pin", "reveal", "close"]);
  assert.deepEqual(menuFor(own, { endTask: true }), ["launch", "pin", "reveal", "endTask", "close"]);
  // An app that asks never to be pinned (PreventPinning) is spawnable but not pinnable.
  assert.deepEqual(menuFor({ ...own, pinnable: false }), ["launch", "reveal", "close"]);
  // End task needs a window, Open file location a window and spawnable.
  assert.deepEqual(menuFor({ key: "p", name: "P", pin, pins: [pin], windows: [] }, { endTask: true }), ["launch", "unpin", "move"]);
  assert.deepEqual(menuFor({ key: "p", name: "P", pin, pins: [pin], windows: [w(1), w(2)] }, { endTask: true }), ["launch", "unpin", "move", "endTask", "closeAll"]);
  assert.deepEqual(menuFor({ key: "p", name: "P", pin, pins: [pin], windows: [w(1)], spawnable: true }), ["launch", "unpin", "move", "reveal", "close"]);
  // Every pinned app moves to a folder; one in a folder also comes out of it.
  assert.deepEqual(menuFor({ key: "p", name: "P", pin, pins: [pin], windows: [w(1)], inFolder: "f" }), ["launch", "unpin", "move", "out", "close"]);
});

test("a menu opens over its button and stays inside the window", () => {
  assert.equal(placeMenu(900, 40, 200, 1920), 820);
  assert.equal(placeMenu(0, 40, 200, 1920), 8);
  assert.equal(placeMenu(1900, 40, 200, 1920), 1712);
  assert.equal(placeMenu(100, 40, 3000, 1920), 8);
});

test("the keys move through a menu's rows and wrap at its ends", () => {
  assert.equal(menuKey("ArrowDown", 0, 3), 1);
  assert.equal(menuKey("ArrowDown", 2, 3), 0);
  assert.equal(menuKey("ArrowUp", 0, 3), 2);
  assert.equal(menuKey("ArrowUp", 2, 3), 1);
  assert.equal(menuKey("ArrowDown", -1, 3), 0); // focus outside the rows: Down goes to the first, Up to the last
  assert.equal(menuKey("ArrowUp", -1, 3), 2);
  assert.equal(menuKey("Home", 2, 3), 0);
  assert.equal(menuKey("End", 0, 3), 2);
  assert.equal(menuKey("Enter", 0, 3), undefined);
  assert.equal(menuKey("ArrowDown", -1, 0), undefined);
});

test("the preview card's tiles step with Right and Left along the bar, mirrored right to left", () => {
  assert.equal(previewKey("ArrowRight", false), "ArrowDown");
  assert.equal(previewKey("ArrowLeft", false), "ArrowUp");
  assert.equal(previewKey("ArrowRight", true), "ArrowUp");
  assert.equal(previewKey("ArrowLeft", true), "ArrowDown");
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Enter"]) assert.equal(previewKey(key, true), key);
});

test("the taskbar settings show only where the bar can run", () => {
  const p = { native: true, mac: false, dev: false, offered: false, enabled: false, demo: false };
  assert.equal(taskbarShown(p), false); // the Store build
  assert.equal(taskbarShown({ ...p, offered: true }), true);
  assert.equal(taskbarShown({ ...p, dev: true }), true);
  assert.equal(taskbarShown({ ...p, enabled: true }), true); // turned on through a backup: it can be turned off
  assert.equal(taskbarShown({ ...p, mac: true, dev: true }), false);
  assert.equal(taskbarShown({ ...p, native: false, dev: true }), false);
});

test("the site's full-screen demo shows the taskbar settings in the browser, only where it offers its bar", () => {
  const browser = { native: false, mac: false, dev: false, offered: false, enabled: false };
  assert.equal(taskbarShown({ ...browser, demo: true }), true);
  assert.equal(taskbarShown({ ...browser, demo: false }), false);
  assert.equal(taskbarShown({ ...browser, enabled: true, demo: false }), false);
});

test("windows pins are added at the end and removed, Crest's own pins and order untouched", () => {
  const f = (id: string) => ({ id, name: id });
  assert.deepEqual(applyWindowsPins([f("a"), f("b"), f("c")], { added: [f("d"), f("a")], removed: ["b"] }), [f("a"), f("c"), f("d")]);
});
test("the remembered windows pins keep only strings, once each", () => {
  assert.deepEqual(normalizeTaskbar({ windowsPins: ["a", 1, "a", "b"] }).windowsPins, ["a", "b"]);
  assert.equal(normalizeTaskbar({}).windowsPins, null);
});

test("the tray arrives once before the clock and stays removed when taken off", () => {
  const seeded = normalizeTaskbar({ zones: { left: [], center: ["start", "apps"], right: ["clock", "crest"] }, widgetsSeeded: true, statusSeeded: true });
  assert.deepEqual(seeded.zones.right, ["tray", "clock", "crest"]);
  const removed = normalizeTaskbar({ ...seeded, zones: { ...seeded.zones, right: ["clock", "crest"] } });
  assert.deepEqual(removed.zones.right, ["clock", "crest"]);
});

test("the tray goes before the Crest menu when there is no clock", () => {
  assert.deepEqual(normalizeTaskbar({ zones: { left: [], center: ["start", "apps"], right: ["crest"] }, widgetsSeeded: true, statusSeeded: true }).zones.right, ["tray", "crest"]);
});

test("Stato arrives once before the clock and stays removed when taken off", () => {
  const seeded = normalizeTaskbar({ zones: { left: [], center: ["start", "apps"], right: ["tray", "clock", "crest"] }, widgetsSeeded: true, traySeeded: true });
  assert.deepEqual(seeded.zones.right, ["tray", "status", "clock", "crest"]);
  assert.equal(seeded.statusSeeded, true);
  const removed = normalizeTaskbar({ ...seeded, zones: { ...seeded.zones, right: ["tray", "clock", "crest"] } });
  assert.deepEqual(removed.zones.right, ["tray", "clock", "crest"]);
});

test("Stato goes before the Crest menu when there is no clock", () => {
  assert.deepEqual(normalizeTaskbar({ zones: { left: [], center: ["start", "apps"], right: ["crest"] }, widgetsSeeded: true, traySeeded: true }).zones.right, ["status", "crest"]);
});

test("Rust follows the network and the volume for the bar only while it is on and shows Stato", () => {
  assert.equal(statusWanted({ ...TASKBAR_DEFAULTS, enabled: true }), true);
  assert.equal(statusWanted({ ...TASKBAR_DEFAULTS, enabled: false }), false);
  assert.equal(statusWanted({ ...TASKBAR_DEFAULTS, enabled: true, zones: { left: [], center: ["start", "apps"], right: ["crest"] } }), false);
});

test("Rust follows the microphone for the Microphone widget only while the bar is on and holds it", () => {
  const zones: Record<Zone, BarItem[]> = { left: ["mic"], center: ["start", "apps"], right: ["crest"] };
  assert.equal(micWanted({ ...TASKBAR_DEFAULTS, enabled: true }), false);
  assert.equal(micWanted({ ...TASKBAR_DEFAULTS, enabled: true, zones }), true);
  assert.equal(micWanted({ ...TASKBAR_DEFAULTS, enabled: false, zones }), false);
});

test("the crypto coin is one the bar offers, Bitcoin otherwise", () => {
  assert.equal(TASKBAR_DEFAULTS.coin, "BTC");
  assert.equal(CRYPTO_COINS[0], "BTC");
  assert.equal(normalizeTaskbar({}).coin, "BTC");
  assert.equal(normalizeTaskbar({ coin: "ETH" }).coin, "ETH");
  for (const coin of ["eth", "PEPE", 3, null]) assert.equal(normalizeTaskbar({ coin }).coin, "BTC", String(coin));
});

test("the icons kept visible are strings, once each", () => {
  assert.deepEqual(normalizeTaskbar({ trayShown: ["a", 2, "a", "b"] }).trayShown, ["a", "b"]);
});

test("the panel's order is strings, once each, and empty at first", () => {
  assert.deepEqual(TASKBAR_DEFAULTS.trayHidden, []);
  assert.deepEqual(normalizeTaskbar({}).trayHidden, []);
  assert.deepEqual(normalizeTaskbar({ trayHidden: "a" }).trayHidden, []);
  assert.deepEqual(normalizeTaskbar({ trayHidden: ["b", null, "a", "b"] }).trayHidden, ["b", "a"]);
});

test("the spy runs only while a bar shows the tray", () => {
  assert.equal(trayWanted({ ...TASKBAR_DEFAULTS, enabled: true }), true);
  assert.equal(trayWanted({ ...TASKBAR_DEFAULTS, enabled: false }), false);
  assert.equal(trayWanted({ ...TASKBAR_DEFAULTS, enabled: true, zones: { left: [], center: ["start", "apps"], right: ["crest"] } }), false);
});

test("the notch tells Rust whether a zone holds the tray, whether the bar is on or off", () => {
  assert.equal(trayOnBar(TASKBAR_DEFAULTS.zones), true);
  assert.equal(trayOnBar({ left: ["tray"], center: ["start", "apps"], right: ["crest"] }), true);
  assert.equal(trayOnBar({ left: [], center: ["start", "apps"], right: ["crest"] }), false);
});

test("with the Battery widget on the bar, Stato and the Hardware widget leave their battery out", () => {
  assert.equal(batteryOnBar(TASKBAR_DEFAULTS.zones), false);
  assert.equal(batteryOnBar({ left: ["battery"], center: ["start", "apps"], right: ["status"] }), true);
});

test("the bar offers every tool but the seven whose widget opens the same panel, and Find on screen last", () => {
  assert.equal(TOOL_BUTTONS.length, 28);
  for (const id of ["timer", "discord", "github", "leetcode", "calendar", "weather", "screentime"]) assert.equal(TOOL_BUTTONS.includes(id), false, id);
  for (const id of ["overview", "media", "notes", "clipboard", "agents", "calc", "wallpapers"]) assert.equal(TOOL_BUTTONS.includes(id), true, id);
  assert.equal(TOOL_BUTTONS.at(-1), "find");
});

test("a tool button enters the bar only for a tool the bar offers, and once", () => {
  assert.deepEqual(
    normalizeZones({ left: ["tool:notes", "tool:x", "tool:timer", "tool:plugin:abc", "tool:settings", "tool:", "notes"], center: ["start", "apps", "tool:notes"], right: ["timer", "tool:find", "crest"] }),
    { left: ["tool:notes"], center: ["start", "apps"], right: ["timer", "tool:find", "crest"] },
  );
});

const Z = (left: BarItem[], center: BarItem[], right: BarItem[]) => ({ left, center, right });

test("a drop puts the item before its neighbour in the saved zones, the hidden ones kept where they were", () => {
  const z = Z([], ["start", "apps"], ["weather", "tool:notes", "tray", "status", "clock", "crest"]);
  assert.deepEqual(moveBefore(z, "clock", "right", "tray"), Z([], ["start", "apps"], ["weather", "tool:notes", "clock", "tray", "status", "crest"]));
  assert.deepEqual(moveBefore(z, "weather", "center", null), Z([], ["start", "apps", "weather"], ["tool:notes", "tray", "status", "clock", "crest"]));
  assert.deepEqual(moveBefore(z, "status", "left", null), Z(["status"], ["start", "apps"], ["weather", "tool:notes", "tray", "clock", "crest"]));
});

test("a drop where the item already is changes nothing, so nothing is written", () => {
  const z = Z([], ["start", "apps"], ["weather", "tray", "clock", "crest"]);
  assert.equal(moveBefore(z, "weather", "right", "tray"), z);
  assert.equal(moveBefore(z, "weather", "right", "weather"), z);
  assert.equal(moveBefore(z, "github", "right", "tray"), z); // not on the bar
  assert.equal(moveBefore(z, "clock", "left", "tray"), z); // its neighbour is not in that zone
});

test("after a step the keyboard stays on the arrow pressed, or goes to the other one once the row reaches that end", () => {
  assert.equal(stepFocus(1, 1, 3), 1);
  assert.equal(stepFocus(1, 2, 3), -1);
  assert.equal(stepFocus(-1, 1, 3), -1);
  assert.equal(stepFocus(-1, 0, 3), 1);
});

test("Up and Down move an item one row among the ones the page lists, and stop at the ends", () => {
  const z = Z([], ["start", "apps"], ["weather", "tray", "clock", "crest"]);
  assert.deepEqual(stepItem(z, z.right, "tray", -1).right, ["tray", "weather", "clock", "crest"]);
  assert.deepEqual(stepItem(z, z.right, "tray", 1).right, ["weather", "clock", "tray", "crest"]);
  assert.deepEqual(stepItem(z, z.right, "clock", 1).right, ["weather", "tray", "crest", "clock"]);
  assert.equal(stepItem(z, z.right, "weather", -1), z);
  assert.equal(stepItem(z, z.right, "crest", 1), z);
  assert.equal(stepItem(z, z.right, "github", 1), z);
  // A saved tool the page does not list never swallows a step.
  const h = Z([], [], ["weather", "tool:notes", "tray"]);
  assert.deepEqual(stepItem(h, ["weather", "tray"], "weather", 1).right, ["tool:notes", "tray", "weather"]);
  assert.deepEqual(stepItem(h, ["weather", "tray"], "tray", -1).right, ["tray", "weather", "tool:notes"]);
});

const slot = (id: BarItem, zone: Zone, x: number, w = 40) => ({ id, zone, x, w });
const grid = [{ zone: "left", x: 0, w: 600 }, { zone: "center", x: 600, w: 0 }, { zone: "right", x: 600, w: 600 }] as { zone: Zone; x: number; w: number }[];

test("a dragged item lands before the item under the pointer's half, in that zone", () => {
  const items = [slot("start", "left", 10), slot("apps", "left", 56), slot("weather", "right", 1000), slot("tray", "right", 1046), slot("clock", "right", 1092)];
  assert.deepEqual(dropPlace("clock", items, grid, 1050, 40, 6), { zone: "right", before: "tray", line: 1042 });
  assert.deepEqual(dropPlace("weather", items, grid, 1140, 40, 6), { zone: "right", before: null, line: 1134 });
  assert.equal(dropPlace("tray", items, grid, 1050, 40, 6), null); // its own place
  assert.equal(dropPlace("weather", items, grid, 1050, 40, 6), null); // right before tray, where it is
  assert.equal(dropPlace("clock", items, grid, 1140, 40, 6), null); // past the end, where it is
});

test("an empty middle zone takes a drop on a band one item wide round its centre", () => {
  const items = [slot("start", "left", 10), slot("weather", "right", 1000), slot("tool:notes", "right", 1046)];
  assert.deepEqual(dropPlace("weather", items, grid, 610, 40, 6), { zone: "center", before: null, line: 599 });
  assert.deepEqual(dropPlace("tool:notes", items, grid, 700, 40, 6), { zone: "right", before: "weather", line: 996 });
});

test("an empty side zone takes a drop anywhere in it, the line at the edge its items start from", () => {
  const items = [slot("start", "center", 560), slot("apps", "center", 606), slot("weather", "right", 1000)];
  const sides = [{ zone: "left", x: 0, w: 560 }, { zone: "center", x: 560, w: 86 }, { zone: "right", x: 646, w: 554 }] as { zone: Zone; x: number; w: number }[];
  assert.deepEqual(dropPlace("weather", items, sides, 30, 40, 6), { zone: "left", before: null, line: 0 });
  assert.deepEqual(dropPlace("weather", items, sides, 120, 40, 6), { zone: "left", before: null, line: 0 });
  assert.deepEqual(dropPlace("start", [slot("start", "center", 560), slot("apps", "center", 606)], sides, 1150, 40, 6), { zone: "right", before: null, line: 1198 });
});

test("in the capsule a drop joins the zone of the item it goes before, or of the last one at the end", () => {
  const items = [slot("start", "center", 500), slot("apps", "center", 546), slot("weather", "right", 592), slot("clock", "right", 638)];
  assert.deepEqual(dropPlace("clock", items, null, 560, 40, 6), { zone: "center", before: "apps", line: 542 });
  assert.deepEqual(dropPlace("weather", items, null, 700, 40, 6), { zone: "right", before: null, line: 680 });
});

test("a dragged pin lands before the first pin whose centre is right of the pointer, after the last past them", () => {
  // Three pinned buttons 40 px wide, 6 px apart.
  const slots = [{ id: "a", x: 100, w: 40 }, { id: "b", x: 146, w: 40 }, { id: "c", x: 192, w: 40 }];
  assert.deepEqual(pinDrop(slots, "c", 110, 6), { before: "a", line: 96 });
  assert.deepEqual(pinDrop(slots, "a", 170, 6), { before: "c", line: 188 });
  assert.deepEqual(pinDrop(slots, "a", 300, 6), { before: null, line: 234 });
  // Its own place, before itself or right after it.
  assert.equal(pinDrop(slots, "b", 130, 6), null);
  assert.equal(pinDrop(slots, "b", 200, 6), null);
  assert.equal(pinDrop(slots, "c", 300, 6), null);
  // Files have no place of their own: every gap takes them.
  assert.deepEqual(pinDrop(slots, null, 130, 6), { before: "b", line: 142 });
  assert.deepEqual(pinDrop(slots, null, 213, 6), { before: null, line: 234 });
  assert.equal(pinDrop([], null, 130, 6), null);
});

test("the window buttons of one pinned app are one slot for a dragged pin or files", () => {
  // Pinned a with three window buttons (one button per window), then pinned b.
  const slots = [{ id: "a", x: 100, w: 40 }, { id: "a", x: 146, w: 40 }, { id: "a", x: 192, w: 40 }, { id: "b", x: 238, w: 40 }];
  // Between a's windows it lands before or after all of them, never inside.
  assert.deepEqual(pinDrop(slots, "b", 140, 6), { before: "a", line: 96 });
  assert.deepEqual(pinDrop(slots, null, 180, 6), { before: "b", line: 234 });
  // Anywhere among its own windows, or right after the last, is a's own place.
  assert.equal(pinDrop(slots, "a", 189, 6), null);
  assert.equal(pinDrop(slots, "a", 250, 6), null);
  assert.deepEqual(pinDrop(slots, "a", 300, 6), { before: null, line: 280 });
});

test("a pin moves before another or to the end, and an unchanged move gives the same array", () => {
  const f = (id: string) => ({ id, name: id });
  const pinned = [f("a"), f("b"), f("c")];
  assert.deepEqual(movePinned(pinned, "c", "a").map((p) => p.id), ["c", "a", "b"]);
  assert.deepEqual(movePinned(pinned, "a", "c").map((p) => p.id), ["b", "a", "c"]);
  assert.deepEqual(movePinned(pinned, "a", null).map((p) => p.id), ["b", "c", "a"]);
  assert.equal(movePinned(pinned, "a", "b"), pinned);
  assert.equal(movePinned(pinned, "b", "b"), pinned);
  assert.equal(movePinned(pinned, "c", null), pinned);
  assert.equal(movePinned(pinned, "x", "a"), pinned);
  assert.equal(movePinned(pinned, "a", "x"), pinned);
});

test("dropped apps go in before a pin in their order, once each, and one already pinned stays where it is", () => {
  const f = (id: string) => ({ id, name: id });
  const pinned = [f("a"), f("b"), f("c")];
  assert.deepEqual(insertPinned(pinned, [f("x"), f("y")], "b").map((p) => p.id), ["a", "x", "y", "b", "c"]);
  assert.deepEqual(insertPinned(pinned, [f("c"), f("x"), f("x")], "a").map((p) => p.id), ["x", "a", "b", "c"]);
  assert.deepEqual(insertPinned(pinned, [f("x")], null).map((p) => p.id), ["a", "b", "c", "x"]);
  assert.deepEqual(insertPinned(pinned, [f("x")], "gone").map((p) => p.id), ["a", "b", "c", "x"]);
  assert.equal(insertPinned(pinned, [f("b")], "a"), pinned);
  assert.deepEqual(insertPinned([], [f("x")], null).map((p) => p.id), ["x"]);
});

test("in the capsule a drop inside the item's own room changes nothing, at the boundary between two zones too", () => {
  // The weather last on the left, the clock first in the middle: right of the weather's centre is still where it is.
  const items = [slot("start", "left", 500), slot("weather", "left", 546), slot("clock", "center", 592), slot("apps", "center", 638)];
  assert.equal(dropPlace("weather", items, null, 580, 40, 6), null);
  assert.equal(dropPlace("weather", items, null, 550, 40, 6), null);
  // The clock left of its centre, next to the weather: still its own place.
  assert.equal(dropPlace("clock", items, null, 590, 40, 6), null);
  // Past the clock's centre the weather does move, into the clock's zone after it.
  assert.deepEqual(dropPlace("weather", items, null, 620, 40, 6), { zone: "center", before: "apps", line: 634 });
});

test("a preview shows a 192 x 120 thumbnail per window, narrower with many, and the titles once they would be too small", () => {
  assert.deepEqual(previewLayout(1, 1920), { kind: "tiles", w: 192, h: 120 });
  assert.deepEqual(previewLayout(8, 1920), { kind: "tiles", w: 192, h: 120 });
  assert.deepEqual(previewLayout(3, 640), { kind: "tiles", w: 190, h: 119 });
  assert.deepEqual(previewLayout(10, 1280), { kind: "list" });
  assert.deepEqual(previewLayout(0, 1920), { kind: "list" });
});

test("an app with several windows and no thumbnail at all lists their titles; one window or a partial failure keeps the tiles", () => {
  const box = { x: 0, y: 0, w: 192, h: 120 };
  assert.equal(previewFallsBack([null, null, null], 3), true);
  assert.equal(previewFallsBack([null], 1), false);
  assert.equal(previewFallsBack([box, null, null], 3), false);
  assert.equal(previewFallsBack([], 3), false);
});

test("a preview sends its boxes again when a window comes, goes, is minimized or restored, not when only a title changes", () => {
  const w = (id: number, minimized = false, title = "t"): Win => ({ id, title, minimized, flashing: false });
  assert.equal(previewSet([w(1), w(2)]), previewSet([w(1, false, "other"), w(2)]));
  assert.notEqual(previewSet([w(1), w(2)]), previewSet([w(1), w(2, true)]));
  assert.notEqual(previewSet([w(1), w(2)]), previewSet([w(1)]));
  assert.notEqual(previewSet([w(1), w(2)]), previewSet([w(2), w(1)]));
});

test("a jump group's heading is Windows' word, or the app's own", () => {
  const g = (kind: "frequent" | "recent" | "custom" | "tasks", title = "") => ({ kind, title, items: [] });
  assert.deepEqual(jumpHeading(g("recent")), { key: "Zuletzt verwendet" });
  assert.deepEqual(jumpHeading(g("frequent")), { key: "Häufig verwendet" });
  assert.deepEqual(jumpHeading(g("tasks")), { key: "Aufgaben" });
  assert.deepEqual(jumpHeading(g("custom", "Most visited")), { text: "Most visited" });
  assert.deepEqual(jumpHeading(g("custom")), { text: "" });
});

test("the bar's Windows keys are off until both switches are on", () => {
  assert.equal(normalizeTaskbar(undefined).winKeys, false);
  assert.equal(normalizeTaskbar({ winKeys: "yes" }).winKeys, false);
  assert.equal(normalizeTaskbar({ winKeys: true }).winKeys, true);
  assert.equal(keysWanted(normalizeTaskbar({ winKeys: true })), false);
  assert.equal(keysWanted(normalizeTaskbar({ enabled: true })), false);
  assert.equal(keysWanted(normalizeTaskbar({ enabled: true, winKeys: true })), true);
});

test("Win+number acts as a click with the same keys, Alt opens the menu", () => {
  const w = (id: number): Win => ({ id, title: "", minimized: false, flashing: false });
  const pin = { id: "p", name: "P" };
  const b = (windows: Win[]): BarButton => ({ key: "p", name: "P", pin, pins: [pin], windows });
  const all = [b([]), b([w(1)]), b([w(2), w(3)])];
  assert.equal(buttonAt(all, 1), all[0]);
  assert.equal(buttonAt(all, 3), all[2]);
  assert.equal(buttonAt(all, 10), undefined); // Win+0 with fewer than ten buttons
  assert.deepEqual(numberKey(undefined, "plain", null), { kind: "none" });
  assert.deepEqual(numberKey(all[0], "plain", null), { kind: "launch", id: "p" });
  assert.deepEqual(numberKey(all[1], "plain", null), { kind: "toggle", id: 1 });
  assert.deepEqual(numberKey(all[2], "plain", null), { kind: "list" });
  assert.deepEqual(numberKey(all[2], "shift", null), { kind: "launch", id: "p" });
  assert.deepEqual(numberKey(all[2], "ctrlShift", null), { kind: "launch", id: "p", admin: true });
  assert.deepEqual(numberKey(all[2], "ctrl", 2), { kind: "activate", id: 3 });
  assert.deepEqual(numberKey(all[2], "ctrl", 3), { kind: "activate", id: 2 }); // round to the first
  assert.deepEqual(numberKey(all[0], "ctrl", null), { kind: "launch", id: "p" }); // no windows: a plain click
  assert.deepEqual(numberKey(all[1], "alt", null), { kind: "menu" });
});

test("Win+T goes round the apps and the arrows stop at the ends", () => {
  assert.equal(cycleKey(-1, 3, 1), 0);
  assert.equal(cycleKey(-1, 3, -1), 2);
  assert.equal(cycleKey(2, 3, 1), 0);
  assert.equal(cycleKey(0, 3, -1), 2);
  assert.equal(barArrow("ArrowRight", 1, 3), 2);
  assert.equal(barArrow("ArrowDown", 1, 3), 2);
  assert.equal(barArrow("ArrowLeft", 1, 3), 0);
  assert.equal(barArrow("ArrowUp", 0, 3), 0);
  assert.equal(barArrow("ArrowRight", 2, 3), 2);
  assert.equal(barArrow("Home", 2, 3), 0);
  assert.equal(barArrow("End", 0, 3), 2);
  assert.equal(barArrow("Tab", 0, 3), undefined);
  assert.equal(barArrow("ArrowRight", 0, 0), undefined);
});

test("a screen reader hears an app's state after its name", () => {
  const w = (id: number, flashing = false): Win => ({ id, title: "", minimized: false, flashing });
  const pin = { id: "p", name: "P" };
  assert.deepEqual(appState({ key: "p", name: "P", pin, pins: [pin], windows: [] }, null), ["pinned"]);
  assert.deepEqual(appState({ key: "g", name: "G", pin: null, pins: [], windows: [w(1), w(2)] }, 2), ["many", "front"]);
  assert.deepEqual(appState({ key: "g", name: "G", pin: null, pins: [], windows: [w(1, true)] }, null), ["one", "attention"]);
});

test("the bar stands on the bottom unless the top is saved", () => {
  assert.equal(normalizeTaskbar({}).position, "bottom");
  assert.equal(normalizeTaskbar({ position: "top" }).position, "top");
  for (const v of ["middle", 1, "left", "right"]) assert.equal(normalizeTaskbar({ position: v }).position, "bottom");
  assert.equal(normalizeTaskbar({}).marks, "dot");
  assert.equal(normalizeTaskbar({ marks: "line" }).marks, "line");
  for (const v of ["big", 3]) assert.equal(normalizeTaskbar({ marks: v }).marks, "dot");
  assert.equal(normalizeTaskbar({}).allDesktops, false);
  assert.equal(normalizeTaskbar({ allDesktops: "yes" }).allDesktops, false);
  assert.equal(normalizeTaskbar({ allDesktops: true }).allDesktops, true);
  assert.deepEqual([...START_ICONS], ["windows", "crest", "dots", "rocket", "sparkle", "star"]);
  assert.equal(TASKBAR_DEFAULTS.startIcon, "windows");
  assert.equal(normalizeTaskbar({}).startIcon, "windows");
  for (const v of START_ICONS) assert.equal(normalizeTaskbar({ startIcon: v }).startIcon, v);
  for (const v of ["orb", "Windows", "logo", 1, null, {}]) assert.equal(normalizeTaskbar({ startIcon: v }).startIcon, "windows");
});

test("the window menu enables what Windows' own system menu would, and the group menu keeps Windows' order", () => {
  const base = { minimized: false, maximized: false, canMinimize: true, canMaximize: true, canSize: true };
  const on = (s: Parameters<typeof windowMenuRows>[0]) => windowMenuRows(s).filter((r) => r.enabled).map((r) => r.entry);
  assert.deepEqual(on(base), ["move", "size", "minimize", "maximize", "close"]);
  assert.deepEqual(on({ ...base, minimized: true }), ["restore", "maximize", "close"]);
  assert.deepEqual(on({ ...base, maximized: true }), ["restore", "minimize", "close"]);
  assert.deepEqual(on({ ...base, canMinimize: false, canMaximize: false, canSize: false }), ["move", "close"]);
  assert.deepEqual(on(null), ["close"]);
  assert.deepEqual(GROUP_MENU, ["cascade", "stack", "side", "restoreAll", "minimizeAll", "closeAll"]);
  const w = { id: 1, title: "", minimized: false, flashing: false };
  const b = { key: "a", name: "A", pin: null, pins: [], windows: [] as (typeof w)[] };
  assert.equal(shiftMenu(b), "app");
  assert.equal(shiftMenu({ ...b, windows: [w] }), "window");
  assert.equal(shiftMenu({ ...b, windows: [w, { ...w, id: 2 }] }), "group");
});

test("a preview dragged in its card: its own place and the next one do nothing, and the window takes the place it is let go at", () => {
  const slots = [0, 100, 200, 300].map((x) => ({ x, w: 96 }));
  assert.equal(previewDrop(slots, 1, 120), null);
  assert.equal(previewDrop(slots, 1, 160), null);
  assert.equal(previewDrop(slots, 1, 10), 0);
  assert.equal(previewDrop(slots, 1, 390), 4);
  assert.equal(previewDrop(slots, 3, 900), null);
  assert.deepEqual(movedOrder([1, 2, 3, 4], 0, 4), [2, 3, 4, 1]);
  assert.deepEqual(movedOrder([1, 2, 3, 4], 3, 0), [4, 1, 2, 3]);
  assert.deepEqual(movedOrder([1, 2, 3, 4], 0, 2), [2, 1, 3, 4]);
});

test("the Recycle Bin's name says empty before the first count, then the count", () => {
  assert.deepEqual(recycleName(null), ["Papierkorb ist leer"]);
  assert.deepEqual(recycleName(0), ["Papierkorb ist leer"]);
  assert.deepEqual(recycleName(1), ["Papierkorb: 1 Element"]);
  assert.deepEqual(recycleName(7), ["Papierkorb: {n} Elemente", { n: 7 }]);
});

test("Rust keeps the own pins of the Launcher's apps along with the bar's", () => {
  const f = (id: string) => ({ id, name: id });
  assert.deepEqual(keptPinIds([f("tool.exe")], [f("Hades.url"), f("Claude")]), ["tool.exe", "Hades.url", "Claude"]);
  assert.deepEqual(keptPinIds([f("a")], null), ["a"]);
});

test("a folder stands at its first app's place, and its open apps join the open apps that are not pinned", () => {
  const w = (id: number): Win => ({ id, title: "t", minimized: false, flashing: false });
  const f = (id: string) => ({ id, name: id.toUpperCase() });
  const pinned = ["a", "b", "c", "d"].map(f);
  const groups: Group[] = [
    { key: "g-x", name: "X", pins: [], windows: [w(1)] },
    { key: "g-c", name: "C", pins: [f("c")], windows: [w(2)] },
    { key: "g-c2", name: "C", pins: [f("c")], windows: [w(3)], spawnable: true },
    { key: "g-a", name: "A", pins: [f("a")], windows: [w(4)] },
  ];
  const folders = [{ id: "f", name: "Work", apps: ["c", "b"] }];
  const b = barButtons(pinned, groups, folders);
  assert.deepEqual(b.map((x) => x.key), ["a", "folder:f", "d", "g-x", "c"]);
  const [folder, open] = [b[1], b[4]];
  assert.deepEqual([folder.name, folder.pin, folder.pins, folder.windows], ["Work", null, [], []]);
  // Its apps in the folder's order, each with the windows it owns.
  assert.deepEqual(folder.folder?.apps.map((x) => [x.key, x.inFolder, x.windows.length]), [["c", "f", 2], ["b", "f", 0]]);
  // An open app of a folder: its pin's key and every window it owns, where its first group is.
  assert.deepEqual([open.inFolder, open.pin?.id, open.windows.map((x) => x.id), open.spawnable], ["f", "c", [2, 3], true]);
  assert.equal(b[0].inFolder, undefined);
  // Without a window an app of a folder has no button of its own.
  assert.equal(b.some((x) => x.key === "b"), false);
  assert.deepEqual(barButtons(null, groups, folders).map((x) => x.key), ["g-x", "g-c", "g-c2", "g-a"]);
});

test("an app of a folder unpinned is no longer drawn in it, the folder goes with its last app, and Rust keeps every folder app's pin", () => {
  const f = (id: string) => ({ id, name: id });
  const pinned = ["a", "b", "c"].map(f);
  const folders = [{ id: "f", name: "F", apps: ["a", "b"] }];
  assert.deepEqual(keptPinIds(pinned, null), ["a", "b", "c"]);
  const after = applyWindowsPins(pinned, { added: [], removed: ["a"] });
  const b = barButtons(after, [], folders);
  assert.deepEqual(b.map((x) => x.key), ["folder:f", "c"]);
  assert.deepEqual(b[0].folder?.apps.map((x) => x.key), ["b"]);
  assert.deepEqual(barButtons(applyWindowsPins(after, { added: [], removed: ["b"] }), [], folders).map((x) => x.key), ["c"]);
});

test("every click on a folder opens it, Win+number too, Win+Alt+number and Shift+right-click its menu", () => {
  const folder: BarButton = { key: "folder:f", name: "F", pin: null, pins: [], windows: [], folder: { id: "f", apps: [] } };
  for (const mods of [{}, { shift: true }, { ctrl: true }, { middle: true }, { shift: true, ctrl: true }]) assert.deepEqual(clickAction(folder, mods, { middle: "close" }), { kind: "folder" });
  for (const m of ["plain", "shift", "ctrl", "ctrlShift"] as const) assert.deepEqual(numberKey(folder, m, null), { kind: "folder" });
  assert.deepEqual(numberKey(folder, "alt", null), { kind: "menu" });
  assert.equal(shiftMenu(folder), "folder");
  assert.equal(indicator(folder, null), "none");
});

test("the window buttons of one app side by side are one place", () => {
  const slots = [{ id: "a", x: 100, w: 40 }, { id: "a", x: 146, w: 40 }, { id: "b", x: 192, w: 40 }, { id: "a", x: 238, w: 40 }];
  assert.deepEqual(pinSlots(slots), [{ id: "a", x: 100, w: 86 }, { id: "b", x: 192, w: 40 }, { id: "a", x: 238, w: 40 }]);
});

test("the bin's warning counts its items, one in the singular", () => {
  assert.deepEqual(emptyWarning(null), ["Der Papierkorb ist leer"]);
  assert.deepEqual(emptyWarning(0), ["Der Papierkorb ist leer"]);
  assert.deepEqual(emptyWarning(1), ["1 Element wird endgültig gelöscht. Das lässt sich nicht rückgängig machen."]);
  assert.deepEqual(emptyWarning(7), ["{n} Elemente werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.", { n: 7 }]);
});
