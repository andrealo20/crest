import { test } from "node:test";
import assert from "node:assert/strict";
import { PART_IDS, type PartId } from "../../notch/row/parts.ts";
import { TASKBAR_DEFAULTS, type BarItem, type Zone } from "./model.ts";
import { SLIDE_KEEP_MS, addWidget, barPartsFor, barSources, barWidgets, isWidget, removeWidget, sourcesAfter, widgetScale, widgetTool } from "./widgets.ts";

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
