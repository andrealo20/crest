import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPACT_PAD,
  TASKBAR_DEFAULTS,
  TOOL_BUTTONS,
  WIDGET_VARIANTS,
  applyWindowsPins,
  barButtons,
  clickAction,
  compactIcon,
  dropPlace,
  fitIcon,
  indicator,
  menuFor,
  menuKey,
  moveBefore,
  moveItem,
  normalizeTaskbar,
  normalizeZones,
  placeMenu,
  previewFallsBack,
  previewKey,
  previewLayout,
  previewSet,
  statusWanted,
  stepFocus,
  stepItem,
  taskbarShown,
  trayIcon,
  trayOnBar,
  trayWanted,
  variantOf,
  type BarButton,
  type BarItem,
  type Group,
  type Win,
  type Zone,
} from "./model.ts";

test("any saved value becomes valid bar settings", () => {
  for (const v of [undefined, null, 0, "x", [], true, { zones: "x", height: "44", surface: 1, pinned: {}, clock: "x" }]) assert.deepEqual(normalizeTaskbar(v), TASKBAR_DEFAULTS);
  assert.equal(normalizeTaskbar({ enabled: "yes" }).enabled, false);
  assert.equal(normalizeTaskbar({ enabled: true }).enabled, true);
  assert.equal(normalizeTaskbar({ autoHide: true }).autoHide, true);
  assert.equal(normalizeTaskbar({ autoHide: "yes" }).autoHide, false);
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
  // The look outlives Glass switched off, so switching it back on brings the same look.
  assert.equal(normalizeTaskbar({ glass: false, glassLook: "plus" }).glassLook, "plus");
});

test("every fixed item sits in exactly one zone", () => {
  assert.deepEqual(normalizeZones({}), { left: [], center: ["start", "apps"], right: ["crest"] });
  assert.deepEqual(normalizeZones({ left: ["crest", "x"], center: ["apps", "crest"] }), { left: ["crest"], center: ["start", "apps"], right: [] });
  assert.deepEqual(normalizeZones({ right: ["apps"] }), { left: [], center: ["start"], right: ["apps", "crest"] }); // a missing item returns at its default index, here past the end
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
  assert.deepEqual(Object.fromEntries(Object.entries(WIDGET_VARIANTS).map(([id, v]) => [id, v[0]])), { weather: "temp", clock: "digital", readings: "dials", timer: "countdown" });
  assert.deepEqual(TASKBAR_DEFAULTS.variants, {});
});

test("a saved version is kept only for a widget that has it, and anything else is dropped", () => {
  assert.deepEqual(normalizeTaskbar({ variants: { weather: "hours", clock: "nope", readings: 3, title: "x", bogus: "line", timer: "ring" } }).variants, { weather: "hours", timer: "ring" });
  for (const v of [undefined, null, "x", [], 1]) assert.deepEqual(normalizeTaskbar({ variants: v }).variants, {});
  assert.deepEqual(normalizeTaskbar({ variants: { clock: "analog" }, clock: { date: false } }).clock, { date: false, seconds: false });
});

test("a widget draws its saved version, today's look for one it does not know, as another window may send raw JSON", () => {
  assert.equal(variantOf({ weather: "hours" }, "weather"), "hours");
  assert.equal(variantOf({ weather: "zzz" }, "weather"), "temp");
  assert.equal(variantOf({ readings: "line" }, "clock"), "digital");
  for (const v of [undefined, null, "x", [], { clock: 1 }, JSON.parse('{"__proto__":{"clock":"analog"}}')]) assert.equal(variantOf(v, "clock"), "digital");
});

test("items move between zones", () => {
  const z = normalizeZones({});
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
});

test("the right-click menu offers what the app allows", () => {
  const w = (id: number): Win => ({ id, title: "t", minimized: false, flashing: false });
  const pin = { id: "p", name: "P" };
  assert.deepEqual(menuFor({ key: "p", name: "P", pin, pins: [pin], windows: [] }), ["newWindow", "unpin"]);
  assert.deepEqual(menuFor({ key: "k", name: "K", pin: null, pins: [pin], windows: [w(1)] }), ["newWindow", "pin", "close"]);
  assert.deepEqual(menuFor({ key: "k", name: "K", pin: null, pins: [], windows: [w(1), w(2)] }), ["closeAll"]);
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
  const p = { native: true, mac: false, dev: false, offered: false, enabled: false };
  assert.equal(taskbarShown(p), false); // the Store build
  assert.equal(taskbarShown({ ...p, offered: true }), true);
  assert.equal(taskbarShown({ ...p, dev: true }), true);
  assert.equal(taskbarShown({ ...p, enabled: true }), true); // turned on through a backup: it can be turned off
  assert.equal(taskbarShown({ ...p, mac: true, dev: true }), false);
  assert.equal(taskbarShown({ ...p, native: false, dev: true }), false);
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

test("the icons kept visible are strings, once each", () => {
  assert.deepEqual(normalizeTaskbar({ trayShown: ["a", 2, "a", "b"] }).trayShown, ["a", "b"]);
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

test("the bar offers every tool but the six whose widget opens the same panel, and Find on screen last", () => {
  assert.equal(TOOL_BUTTONS.length, 27);
  for (const id of ["timer", "discord", "github", "leetcode", "calendar", "weather"]) assert.equal(TOOL_BUTTONS.includes(id), false, id);
  for (const id of ["overview", "media", "notes", "clipboard", "agents", "calc"]) assert.equal(TOOL_BUTTONS.includes(id), true, id);
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
