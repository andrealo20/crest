import { test } from "node:test";
import assert from "node:assert/strict";
import { PART_IDS, type PartId } from "../../notch/row/parts.ts";
import { DEFAULT_OFF, TOOL_IDS } from "../../settings/tools.ts";
import { TASKBAR_DEFAULTS, TOOL_BUTTONS, type BarItem, type Zone } from "./model.ts";
import { SLIDE_KEEP_MS, addWidget, addableTools, barPartsFor, barSources, barWidgets, isTool, isWidget, removeWidget, shownZones, sourcesAfter, toolOf, toolShown, widgetScale, widgetTool } from "./widgets.ts";

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
