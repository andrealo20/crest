import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPACT_PAD,
  TASKBAR_DEFAULTS,
  TOOL_BUTTONS,
  applyWindowsPins,
  barButtons,
  clickAction,
  compactIcon,
  fitIcon,
  indicator,
  menuFor,
  menuKey,
  moveItem,
  normalizeTaskbar,
  normalizeZones,
  placeMenu,
  statusWanted,
  taskbarShown,
  trayIcon,
  trayOnBar,
  trayWanted,
  type BarButton,
  type BarItem,
  type Group,
  type Win,
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

test("the taskbar settings show only where the bar can run", () => {
  const p = { native: true, mac: false, dev: false, preview: false, enabled: false };
  assert.equal(taskbarShown(p), false);
  assert.equal(taskbarShown({ ...p, preview: true }), true);
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
