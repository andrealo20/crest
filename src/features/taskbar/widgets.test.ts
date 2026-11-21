import { test } from "node:test";
import assert from "node:assert/strict";
import { PART_IDS, type PartId } from "../../notch/row/parts.ts";
import { DEFAULT_OFF, TOOL_IDS } from "../../settings/tools.ts";
import { TASKBAR_DEFAULTS, TOOL_BUTTONS, type BarItem, type Zone } from "./model.ts";
import { statusPill } from "./statusModel.ts";
import { SLIDE_KEEP_MS, addWidget, addableSys, addableTools, applyChoice, chosenChoice, clockHasSeconds, barPartsFor, barSources, barWidgets, isSys, isTool, isWidget, pillWidget, previewInk, removeWidget, shownZones, sourcesAfter, sysPrimaryOnly, toolOf, toolShown, variantKey, widgetChoices, widgetScale, widgetTool, widgetWidth } from "./widgets.ts";

test("a widget's preview wears the bar's ink: Dark's under Liquid Glass + whatever the surface, the closed notch's on Notch, the theme's otherwise", () => {
  const dark = { "--color-label": "white", "--theme-accent": "blue" }, closed = { "--color-label": "white", "--accent": "red" };
  assert.deepEqual(previewInk("plus", "theme", closed, dark), { ...dark, "--accent": "blue" });
  assert.deepEqual(previewInk("plus", "notch", undefined, dark), { ...dark, "--accent": "blue" });
  assert.equal(previewInk("crest", "notch", closed, dark), closed);
  assert.equal(previewInk("crest", "theme", closed, dark), undefined);
});

test("a widget opens its tool, the clock Windows' calendar", () => {
  // Every part: one without a tool would open Windows' calendar.
  const tools: Record<Exclude<PartId, "clock">, string> = { title: "media", equalizer: "media", timer: "timer", rings: "usage", readings: "system", script: "notices", downloads: "shelf", weather: "weather", calendar: "calendar", discord: "discord", github: "github", leetcode: "leetcode" };
  for (const id of PART_IDS) assert.equal(widgetTool(id), id === "clock" ? null : tools[id], id);
  assert.ok(isWidget("clock") && !isWidget("apps") && !isWidget("crest"));
});

test("widgets grow and shrink with the icons", () => {
  assert.equal(widgetScale(44, 24), 1);
  assert.equal(widgetScale(64, 40), 40 / 24);
  assert.equal(widgetScale(32, 24), 20 / 24);
});

test("weather and hardware sit in Stato's pill off Tiles, as wide as their content and the pill's two sides", () => {
  assert.equal(pillWidget("weather", false), true);
  assert.equal(pillWidget("readings", false), true);
  assert.equal(pillWidget("weather", true), false);
  assert.equal(pillWidget("clock", false), false);
  assert.equal(pillWidget("title", false), false);
  // Without the pill a button keeps 8 px each side; in it, the pill's own sides: 14, 20 and 30 px at 32, 44 and 64 px.
  assert.equal(widgetWidth(48, 1, null), 64);
  assert.equal(widgetWidth(47, 1, null), 64);
  assert.equal(widgetWidth(48, 1, statusPill(44).pad), 68);
  assert.equal(widgetWidth(48, 20 / 24, statusPill(32).pad), 54);
  assert.equal(widgetWidth(48, 1, statusPill(64).pad), 78);
});

test("an added widget goes last in its zone, before the Crest button at its end", () => {
  const z = TASKBAR_DEFAULTS.zones;
  assert.deepEqual(addWidget(z, "timer", "right").right, ["weather", "tray", "status", "clock", "timer", "crest"]);
  assert.deepEqual(addWidget(z, "timer", "left").left, ["timer"]);
  assert.deepEqual(addWidget({ ...z, right: ["crest", "weather"] }, "timer", "right").right, ["crest", "weather", "timer"]);
  assert.deepEqual(addWidget(z, "clock", "left"), z);
});

test("a removed widget leaves the bar", () => {
  assert.deepEqual(removeWidget(TASKBAR_DEFAULTS.zones, "clock").right, ["weather", "tray", "status", "crest"]);
  assert.deepEqual(barWidgets(TASKBAR_DEFAULTS.zones), ["weather", "clock"]);
});

test("the stores run the bar's widgets while it shows, only Discord while it hides, none while it is off", () => {
  const widgets: PartId[] = ["weather", "discord", "clock"];
  assert.deepEqual(barPartsFor(widgets, true, true), widgets);
  assert.deepEqual(barPartsFor(widgets, true, false), ["discord"]);
  assert.deepEqual(barPartsFor(["weather", "clock"], true, false), []);
  assert.deepEqual(barPartsFor(widgets, false, true), []);
  assert.deepEqual(barPartsFor(widgets, false, false), []);
});

test("the notch captures the audio for a bar's Now Playing panel as for the equalizer widget, once", () => {
  assert.deepEqual(barSources(["weather", "clock"], false), ["weather", "clock"]);
  assert.deepEqual(barSources(["weather", "clock"], true), ["weather", "clock", "equalizer"]);
  assert.deepEqual(barSources(["equalizer", "title"], true), ["equalizer", "title"]);
  assert.deepEqual(barSources([], true), ["equalizer"]);
});

test("the tray can be added back like a widget", () => {
  const zones: Record<Zone, BarItem[]> = { left: [], center: ["start", "apps"], right: ["clock", "crest"] };
  assert.deepEqual(addWidget(zones, "tray", "right").right, ["clock", "tray", "crest"]);
  assert.equal(addWidget(TASKBAR_DEFAULTS.zones, "tray", "left"), TASKBAR_DEFAULTS.zones);
});

test("Windows' buttons are the four the bar knows, Windows widgets on the main bar only, offered while off the bar", () => {
  assert.equal(isSys("sys:search"), true);
  assert.equal(isSys("sys:nope"), false);
  assert.equal(isSys("search"), false);
  assert.equal(isSys("tool:notes"), false);
  assert.deepEqual((["sys:search", "sys:taskview", "sys:widgets", "sys:desktop"] as const).filter(sysPrimaryOnly), ["sys:widgets"]);
  const zones: Record<Zone, BarItem[]> = { left: ["sys:taskview"], center: ["start", "apps"], right: ["crest"] };
  assert.deepEqual(addableSys(zones), ["sys:search", "sys:widgets", "sys:desktop"]);
  assert.deepEqual(addWidget(zones, "sys:desktop", "right").right, ["sys:desktop", "crest"]);
  assert.deepEqual(addableSys({ left: ["sys:search", "sys:taskview", "sys:widgets"], center: ["sys:desktop"], right: [] }), []);
});

test("Stato can be added back like the tray", () => {
  const zones: Record<Zone, BarItem[]> = { left: [], center: ["start", "apps"], right: ["clock", "crest"] };
  assert.deepEqual(addWidget(zones, "status", "right").right, ["clock", "status", "crest"]);
  assert.deepEqual(removeWidget(TASKBAR_DEFAULTS.zones, "status").right, ["weather", "tray", "clock", "crest"]);
});

test("the bar's sources run through a slide's first 30 s and stop at once when its window hides", () => {
  const up = { shown: true, slid: false }, down = { shown: true, slid: true };
  const hidden = { shown: false, slid: false }, hiddenDown = { shown: false, slid: true };
  assert.equal(SLIDE_KEEP_MS, 30_000);
  assert.equal(sourcesAfter(up, down), "keep"); // a slide starts: running for SLIDE_KEEP_MS, then resting
  assert.equal(sourcesAfter(down, up), "run");
  assert.equal(sourcesAfter(up, hidden), "rest"); // a full-screen app or the hide hotkey: at once
  assert.equal(sourcesAfter(down, hiddenDown), "rest"); // hidden while slid: at once, the slide's wait cut short
  assert.equal(sourcesAfter(hiddenDown, down), "rest"); // shown again but still slid: no slide started
  assert.equal(sourcesAfter(hidden, up), "run");
  assert.equal(sourcesAfter(down, down), null); // nothing changed: as they are, the wait going on
});

const switches = [{ id: "clipboard", enabled: false }, { id: "ask", enabled: true }, { id: "notes", enabled: false }];

test("a tool button shows while its tool can open, and the bar draws only those", () => {
  assert.equal(toolShown("notes", switches), true); // the panel's, off in the notch
  assert.equal(toolShown("ask", switches), true);
  assert.equal(toolShown("clipboard", switches), false); // the notch would open another tool
  assert.equal(toolShown("vault", switches), false); // missing from the list counts as off
  assert.equal(toolShown("find", switches), true); // a page, no switch
  assert.equal(toolShown("xyz", switches), false); // an id that skipped normalizeZones (storeCore.ts:51-57 hands over raw JSON)
  const zones: Record<Zone, BarItem[]> = { left: ["tool:clipboard", "tool:ask"], center: ["start", "apps"], right: ["tool:notes", "weather", "crest"] };
  assert.deepEqual(shownZones(zones, switches), { left: ["tool:ask"], center: ["start", "apps"], right: ["tool:notes", "weather", "crest"] });
});

test("Add tool offers the tools not on the bar, those of the notch only while on there", () => {
  const offered = addableTools({ left: ["tool:ask"], center: ["start", "apps"], right: ["crest"] }, switches);
  assert.equal(offered.includes("ask"), false);
  assert.equal(offered.includes("clipboard"), false);
  assert.ok(offered.includes("notes") && offered.includes("media") && offered.includes("find"));
  const factory = TOOL_IDS.map((id) => ({ id, enabled: !DEFAULT_OFF.has(id) }));
  assert.equal(addableTools(TASKBAR_DEFAULTS.zones, factory).length, 18);
  assert.ok(addableTools(TASKBAR_DEFAULTS.zones, factory).every((id) => TOOL_BUTTONS.includes(id)));
});

test("a tool button is added and taken off like a widget, apart from the widget of a similar id", () => {
  const z = TASKBAR_DEFAULTS.zones;
  assert.deepEqual(addWidget(z, "tool:media", "right").right, ["weather", "tray", "status", "clock", "tool:media", "crest"]);
  assert.deepEqual(removeWidget(addWidget(z, "tool:media", "right"), "tool:media"), z);
  assert.ok(isTool("tool:media") && !isTool("media") && !isTool("timer"));
  assert.equal(toolOf("tool:find"), "find");
  assert.deepEqual(barWidgets(addWidget(z, "tool:media", "left")), ["weather", "clock"]);
});

test("the clock's versions: time and date, time alone, analog, and two zones only with a zone in Clocks", () => {
  assert.deepEqual(widgetChoices("clock", false), [{ variant: "digital", date: true }, { variant: "digital", date: false }, { variant: "analog" }]);
  assert.deepEqual(widgetChoices("clock", true).at(-1), { variant: "zones" });
  assert.deepEqual(widgetChoices("weather", false).map((c) => c.variant), ["temp", "icon", "condition", "hours"]);
  assert.deepEqual(widgetChoices("readings", true).map((c) => c.variant), ["dials", "bars", "line"]);
  assert.deepEqual(widgetChoices("title", true), [{ variant: null }]);
});

test("the chosen version is the saved one, the clock's digital ones by its date, two zones without a zone back on the digital clock", () => {
  assert.equal(chosenChoice("clock", {}, true, false), 0);
  assert.equal(chosenChoice("clock", {}, false, false), 1);
  assert.equal(chosenChoice("clock", { clock: "analog" }, true, false), 2);
  assert.equal(chosenChoice("clock", { clock: "zones" }, true, true), 3);
  assert.equal(chosenChoice("clock", { clock: "zones" }, false, false), 1);
  assert.equal(chosenChoice("weather", { weather: "hours" }, true, false), 3);
  assert.equal(chosenChoice("weather", "x", true, false), 0);
  assert.equal(chosenChoice("title", {}, true, false), 0);
});

test("picking a version writes the version, and the clock's digital ones its date, nothing else", () => {
  const cur = { variants: { weather: "hours", clock: "analog" }, clock: { date: true, seconds: true } } as const;
  assert.deepEqual(applyChoice(cur, "clock", { variant: "digital", date: false }), { variants: { weather: "hours" }, clock: { date: false, seconds: true } });
  assert.deepEqual(applyChoice(cur, "clock", { variant: "zones" }), { variants: { weather: "hours", clock: "zones" } });
  assert.deepEqual(applyChoice(cur, "weather", { variant: "icon" }), { variants: { weather: "icon", clock: "analog" } });
  assert.deepEqual(applyChoice(cur, "title", { variant: null }), {});
  // Another window may hand over raw JSON without variants (storeCore.ts:51-57): the pick still works.
  assert.deepEqual(applyChoice({ variants: undefined as never, clock: { date: true, seconds: false } }, "clock", { variant: "digital", date: false }), { variants: {}, clock: { date: false, seconds: false } });
  assert.deepEqual(applyChoice({ variants: "x" as never, clock: { date: true, seconds: false } }, "weather", { variant: "icon" }), { variants: { weather: "icon" } });
});

test("a pick writes only what differs from the saved settings, so Two time zones saved without a zone gives way to the digital clock shown", () => {
  const clock = { date: true, seconds: false };
  // Shown as Time and date (no zone), saved as Two time zones: picking what is shown saves it.
  assert.deepEqual(applyChoice({ variants: { clock: "zones" }, clock }, "clock", { variant: "digital", date: true }), { variants: {}, clock });
  // Saved as shown: nothing to write.
  assert.deepEqual(applyChoice({ variants: {}, clock }, "clock", { variant: "digital", date: true }), {});
  assert.deepEqual(applyChoice({ variants: { weather: "hours" }, clock }, "weather", { variant: "hours" }), {});
});

test("only the digital clock has seconds to switch: not Analog, not Two time zones while a zone draws them", () => {
  assert.equal(clockHasSeconds({}, false), true);
  assert.equal(clockHasSeconds({ clock: "analog" }, true), false);
  assert.equal(clockHasSeconds({ clock: "zones" }, true), false);
  // Without a zone the bar draws the digital clock for Two time zones.
  assert.equal(clockHasSeconds({ clock: "zones" }, false), true);
  assert.equal(clockHasSeconds("x", true), true);
});

test("the arrows move through a widget's versions and wrap, mirrored right to left", () => {
  assert.equal(variantKey("ArrowRight", 0, 4, false), 1);
  assert.equal(variantKey("ArrowDown", 3, 4, false), 0);
  assert.equal(variantKey("ArrowLeft", 0, 4, false), 3);
  assert.equal(variantKey("ArrowUp", 1, 4, false), 0);
  assert.equal(variantKey("ArrowRight", 0, 4, true), 3);
  assert.equal(variantKey("ArrowLeft", 0, 4, true), 1);
  assert.equal(variantKey("Home", 2, 4, false), 0);
  assert.equal(variantKey("End", 0, 4, false), 3);
  assert.equal(variantKey("Enter", 0, 4, false), undefined);
});
