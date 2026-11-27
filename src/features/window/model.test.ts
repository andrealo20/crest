import { test } from "node:test";
import assert from "node:assert/strict";
import { altGrRisk } from "./hotkeys.ts";
import { MAX_APP_RULES, MAX_TOOL_HOTKEYS, WINDOW_DEFAULTS, addRule, cycle, exeName, newRule, normalizeWindow, ruleKey, startTool, stripScroll } from "./model.ts";

test("without a saved group the rules follow the old visibility setting", () => {
  assert.deepEqual(normalizeWindow(undefined).rules, WINDOW_DEFAULTS.rules);
  // The old setting only read the window in front, so the check behind starts off.
  assert.deepEqual(normalizeWindow(undefined, "hide-fullscreen").rules, { maximized: "normal", borderless: "hide", exclusive: "hide", background: false });
  assert.equal(WINDOW_DEFAULTS.rules.background, true);
  // Once saved, the old setting no longer matters.
  assert.equal(normalizeWindow({ rules: { borderless: "line" } }, "hide-fullscreen").rules.borderless, "line");
});

test("Crest stays on top unless Behind other windows is switched on", () => {
  assert.equal(normalizeWindow(undefined).behind, false);
  assert.equal(normalizeWindow({}).behind, false);
  assert.equal(normalizeWindow({ behind: true }).behind, true);
  assert.equal(normalizeWindow({ behind: "yes" }).behind, false);
});

test("broken values fall back, valid ones stay", () => {
  const w = normalizeWindow({ rules: { maximized: "bogus", exclusive: "hide", background: "yes" }, scale: 150, closeDelay: "slow", wheelTools: false });
  assert.deepEqual(w.rules, { maximized: "normal", borderless: "normal", exclusive: "hide", background: true });
  assert.equal(w.scale, 150);
  assert.equal(w.closeDelay, "fast");
  assert.equal(w.wheelTools, false);
  assert.equal(w.rightClickSettings, true);
  // Both on unless turned off (#50): the grips at the panel's edges and a hovered part picking the tool.
  assert.equal(w.resizeEdges, true);
  assert.equal(w.hoverParts, true);
  const off = normalizeWindow({ resizeEdges: false, hoverParts: false });
  assert.equal(off.resizeEdges, false);
  assert.equal(off.hoverParts, false);
  assert.equal(normalizeWindow({ resizeEdges: "no", hoverParts: 0 }).resizeEdges, true);
});

test("the tool bar stays at the bottom with its background unless saved otherwise (#76)", () => {
  assert.equal(WINDOW_DEFAULTS.toolBar, "bottom");
  assert.equal(WINDOW_DEFAULTS.toolBarFill, true);
  const top = normalizeWindow({ toolBar: "top", toolBarFill: false });
  assert.equal(top.toolBar, "top");
  assert.equal(top.toolBarFill, false);
  const broken = normalizeWindow({ toolBar: "left", toolBarFill: "no" });
  assert.equal(broken.toolBar, "bottom");
  assert.equal(broken.toolBarFill, true);
  assert.equal(normalizeWindow(undefined).toolBar, "bottom");
  assert.equal(normalizeWindow(undefined).toolBarFill, true);
});

test("the selected tool's name shows unless saved off, also in settings saved before the switch", () => {
  assert.equal(WINDOW_DEFAULTS.toolNames, true);
  assert.equal(normalizeWindow({}).toolNames, true);
  assert.equal(normalizeWindow({ toolNames: false }).toolNames, false);
  assert.equal(normalizeWindow({ toolNames: "no" }).toolNames, true);
});

test("hotkeys: missing open takes the default, an empty one stays unset, invalid ones are dropped", () => {
  assert.equal(normalizeWindow({}).hotkeys.open, "Ctrl+Alt+Space");
  assert.equal(normalizeWindow({ hotkeys: { open: "" } }).hotkeys.open, "");
  assert.deepEqual(normalizeWindow({ hotkeys: { open: "KeyK", hide: "ctrl+alt+KeyH", resize: "Alt+Arrows" } }).hotkeys, { open: "", hide: "Ctrl+Alt+KeyH", resize: "", find: "Ctrl+Alt+Shift+KeyF", mic: "", search: "" });
  // The bar search key starts unset: Alt+Space is Windows window menu and PowerToys Run, so it is asked for, never taken.
  assert.equal(normalizeWindow({}).hotkeys.search, "");
  assert.equal(normalizeWindow({ hotkeys: { search: "alt+Space" } }).hotkeys.search, "Alt+Space");
  assert.equal(normalizeWindow({ hotkeys: { find: "" } }).hotkeys.find, "");
  // The microphone mute starts unset, keeps a good combination and drops a bare letter.
  assert.equal(normalizeWindow({}).hotkeys.mic, "");
  assert.equal(normalizeWindow({ hotkeys: { mic: "alt+shift+KeyM" } }).hotkeys.mic, "Alt+Shift+KeyM");
  assert.equal(normalizeWindow({ hotkeys: { mic: "KeyM" } }).hotkeys.mic, "");
});

test("tool shortcuts keep usable combinations by tool id and drop the rest", () => {
  assert.deepEqual(normalizeWindow({}).toolHotkeys, {});
  assert.deepEqual(normalizeWindow({ toolHotkeys: [] }).toolHotkeys, {});
  assert.deepEqual(
    normalizeWindow({ toolHotkeys: { clipboard: "alt+ctrl+KeyV", shelf: "KeyS", notes: 5, "plugin:clock": "F9", "": "Ctrl+Alt+KeyX", todos: "Ctrl+Alt+Arrows" } }).toolHotkeys,
    { clipboard: "Ctrl+Alt+KeyV", "plugin:clock": "F9" },
  );
  const many = Object.fromEntries(Array.from({ length: MAX_TOOL_HOTKEYS + 5 }, (_, i) => [`plugin:p${i}`, "F1"]));
  assert.equal(Object.keys(normalizeWindow({ toolHotkeys: many }).toolHotkeys).length, MAX_TOOL_HOTKEYS);
});

test("app rules: keys, duplicates, follow values and the cap", () => {
  assert.equal(ruleKey({ name: "Foo", path: "C:/Games/Foo.EXE" }), "path:c:\\games\\foo.exe");
  assert.equal(ruleKey({ name: "Foo.exe", path: "" }), "name:foo");
  assert.equal(exeName("C:\\Games\\Foo.exe"), "Foo");
  const rule = newRule("vlc.exe");
  assert.deepEqual(rule, { name: "vlc", path: "", maximized: "normal", borderless: "normal", exclusive: "normal" });
  assert.equal(addRule([rule], newRule("VLC")).length, 1);
  assert.equal(addRule([], newRule("")).length, 0);
  const full = Array.from({ length: MAX_APP_RULES }, (_, i) => newRule(`app${i}`));
  assert.equal(addRule(full, newRule("one-more")).length, MAX_APP_RULES);
  const saved = normalizeWindow({ apps: [{ name: "mpv", path: "", maximized: "line", borderless: "x" }, { name: "MPV.exe" }, null] }).apps;
  assert.deepEqual(saved, [{ name: "mpv", path: "", maximized: "line", borderless: null, exclusive: null }]);
});

test("cycling tools wraps and skips when there is nothing to switch to", () => {
  assert.equal(cycle(["a", "b", "c"], "c", 1), "a");
  assert.equal(cycle(["a", "b", "c"], "a", -1), "c");
  assert.equal(cycle(["a", "b"], "settings", 1), "a");
  assert.equal(cycle(["a"], "a", 1), null);
});

test("no default shortcut is one an AltGr layout would type with", () => {
  for (const kind of ["open", "hide", "resize", "find"] as const) assert.equal(altGrRisk(kind, WINDOW_DEFAULTS.hotkeys[kind]), false, kind);
});

test("saved text sizes per tool survive a reload; a fresh install has none", () => {
  assert.deepEqual(WINDOW_DEFAULTS.textSizes, {});
  assert.deepEqual(normalizeWindow({ textSizes: { notes: 150, calc: 42 } }).textSizes, { notes: 150 });
  assert.deepEqual(normalizeWindow({}).textSizes, {});
});

test("a vertical wheel scrolls a strip that overflows sideways, toward its end in either text direction", () => {
  assert.equal(stripScroll(0, 100, 240, false), 100);
  assert.equal(stripScroll(0, -100, 240, false), -100);
  // Right to left, scrollLeft runs from 0 down to negative values.
  assert.equal(stripScroll(4, 100, 240, true), -100);
});

test("a strip leaves the wheel alone when nothing is hidden or the wheel already runs sideways", () => {
  assert.equal(stripScroll(0, 100, 0, false), 0);
  assert.equal(stripScroll(0, 100, 1, false), 0);
  assert.equal(stripScroll(120, 30, 240, false), 0);
  assert.equal(stripScroll(0, 0, 240, false), 0);
});

test("the notch opens on the live activity, the tool open last or a tool of the user's choosing (#87)", () => {
  assert.equal(normalizeWindow({}).openOn, "live");
  assert.equal(normalizeWindow({ openOn: "last" }).openOn, "last");
  assert.equal(normalizeWindow({ openOn: "timer" }).openOn, "timer");
  assert.equal(normalizeWindow({ openOn: "plugin:my_tool" }).openOn, "plugin:my_tool");
  for (const bad of ["../x", "", 5, null, "a".repeat(65)]) assert.equal(normalizeWindow({ openOn: bad }).openOn, "live");
  const tools = ["media", "timer", "notes"];
  // Live: the activity's tool (the song's), unless the notch reopens right after closing; nothing live keeps the last tool.
  assert.equal(startTool("live", "media", tools, false), "media");
  assert.equal(startTool("live", "media", tools, true), null);
  assert.equal(startTool("live", null, tools, false), null);
  // The last tool: never moved.
  assert.equal(startTool("last", "media", tools, false), null);
  // A chosen tool, whatever plays, and every time: also within the minute that otherwise resumes where the notch was.
  assert.equal(startTool("timer", "media", tools, false), "timer");
  assert.equal(startTool("timer", "media", tools, true), "timer");
  // A chosen tool no longer in the tool bar: as live.
  assert.equal(startTool("weather", "media", tools, false), "media");
});
