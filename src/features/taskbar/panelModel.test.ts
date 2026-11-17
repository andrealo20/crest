import { test } from "node:test";
import assert from "node:assert/strict";
import { BAR_TOOLS, fitPanel, opensInBar, panelKey, sameContent, toolPanelSize, withPanel, type PanelContent } from "./panelModel.ts";

const apps: PanelContent = { kind: "apps" };
const tool = (id: string): PanelContent => ({ kind: "tool", tool: id });

test("the app menu and the twelve widget tools open in the bar, any other tool in the notch", () => {
  assert.equal(opensInBar(apps), true);
  for (const id of BAR_TOOLS) assert.equal(opensInBar(tool(id)), true, id);
  for (const id of ["vault", "terminal", "settings"]) assert.equal(opensInBar(tool(id)), false, id);
  assert.equal(BAR_TOOLS.length, 12);
});

test("the same content toggles, another one takes its place", () => {
  assert.equal(sameContent(apps, apps), true);
  assert.equal(sameContent(tool("media"), tool("media")), true);
  assert.equal(sameContent(tool("media"), tool("timer")), false);
  assert.equal(sameContent(apps, tool("media")), false);
  assert.equal(sameContent(apps, tool("apps")), false);
  assert.equal(panelKey(apps), "apps");
  assert.equal(panelKey(tool("weather")), "weather");
});

test("the notch keeps what each bar's panel shows", () => {
  const none: Record<string, string> = {};
  const opened = withPanel(none, { label: "taskbar", open: "apps" });
  assert.deepEqual(opened, { taskbar: "apps" });
  const switched = withPanel(opened, { label: "taskbar", open: "media" });
  assert.deepEqual(switched, { taskbar: "media" });
  // A new record each time: the store's readers compare by identity.
  assert.deepEqual([none, opened], [{}, { taskbar: "apps" }]);
  const both = withPanel(switched, { label: "taskbar-1", open: "apps" });
  assert.deepEqual(both, { taskbar: "media", "taskbar-1": "apps" });
  assert.deepEqual(withPanel(both, { label: "taskbar", open: null }), { "taskbar-1": "apps" });
  for (const bad of [{ open: "apps" }, { label: "taskbar", open: 5 }, null, "taskbar", { label: "", open: "apps" }, { label: "taskbar" }]) {
    assert.equal(withPanel(both, bad), both, JSON.stringify(bad));
  }
});

test("a tool in the bar has no tool bar", () => {
  assert.deepEqual(toolPanelSize({ w: 640, h: 330 }), { w: 640, h: 284 });
});

test("the panel fits the room above the bar at any scale", () => {
  assert.deepEqual(fitPanel({ w: 640, h: 284 }, { w: 1904, h: 568 }, 1), { w: 640, h: 284 });
  assert.deepEqual(fitPanel({ w: 720, h: 494 }, { w: 1904, h: 568 }, 1.25), { w: 720, h: 454 });
  assert.deepEqual(fitPanel({ w: 560, h: 294 }, { w: 1350, h: 512 }, 2), { w: 560, h: 256 });
  assert.deepEqual(fitPanel({ w: 740, h: 300 }, { w: 1000, h: 568 }, 1.5), { w: 666, h: 300 });
});
