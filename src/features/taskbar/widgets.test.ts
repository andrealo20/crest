import { test } from "node:test";
import assert from "node:assert/strict";
import { TASKBAR_DEFAULTS } from "./model.ts";
import { addWidget, barWidgets, isWidget, removeWidget, widgetScale, widgetTool } from "./widgets.ts";

test("a widget opens its tool, the clock Windows' calendar", () => {
  assert.equal(widgetTool("clock"), null);
  for (const [id, tool] of [["title", "media"], ["equalizer", "media"], ["timer", "timer"], ["rings", "usage"], ["readings", "system"], ["script", "notices"], ["downloads", "shelf"], ["weather", "weather"], ["calendar", "calendar"], ["discord", "discord"], ["github", "github"], ["leetcode", "leetcode"]] as const)
    assert.equal(widgetTool(id), tool);
  assert.ok(isWidget("clock") && !isWidget("apps") && !isWidget("crest"));
});

test("widgets grow and shrink with the icons", () => {
  assert.equal(widgetScale(44, 24), 1);
  assert.equal(widgetScale(64, 40), 40 / 24);
  assert.equal(widgetScale(32, 24), 20 / 24);
});

test("an added widget goes last in its zone, before the Crest button at its end", () => {
  const z = TASKBAR_DEFAULTS.zones;
  assert.deepEqual(addWidget(z, "timer", "right").right, ["weather", "clock", "timer", "crest"]);
  assert.deepEqual(addWidget(z, "timer", "left").left, ["timer"]);
  assert.deepEqual(addWidget({ ...z, right: ["crest", "weather"] }, "timer", "right").right, ["crest", "weather", "timer"]);
  assert.deepEqual(addWidget(z, "clock", "left"), z);
});

test("a removed widget leaves the bar", () => {
  assert.deepEqual(removeWidget(TASKBAR_DEFAULTS.zones, "clock").right, ["weather", "crest"]);
  assert.deepEqual(barWidgets(TASKBAR_DEFAULTS.zones), ["weather", "clock"]);
});
