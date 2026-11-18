import { test } from "node:test";
import assert from "node:assert/strict";
import type { Favorite, LauncherApp } from "../launcher/apps.ts";
import { BAR_TOOLS, dropSlot, fitPanel, opensInBar, panelKey, pinAt, sameAnchor, sameContent, toolPanelSize, withPanel, type PanelContent } from "./panelModel.ts";

const tool = (id: string): PanelContent => ({ kind: "tool", tool: id });
const app = (name: string): LauncherApp => ({ id: `shell:AppsFolder\\${name}`, name, source: "start" });

test("the twelve widget tools open in the bar, any other tool in the notch", () => {
  for (const id of BAR_TOOLS) assert.equal(opensInBar(tool(id)), true, id);
  for (const id of ["vault", "terminal", "settings"]) assert.equal(opensInBar(tool(id)), false, id);
  assert.equal(BAR_TOOLS.length, 12);
});

test("the same content toggles, another one takes its place", () => {
  assert.equal(sameContent(tool("media"), tool("media")), true);
  assert.equal(sameContent(tool("media"), tool("timer")), false);
  assert.equal(panelKey(tool("weather")), "weather");
});

test("an item stays the same item while it shifts or resizes under its panel, and two items never are", () => {
  const item = { x: 120, w: 40 };
  // Itself, shifted by a few px either way or by most of its width, and wider (a clock that grew).
  for (const moved of [item, { x: 124, w: 40 }, { x: 116.5, w: 40 }, { x: 156, w: 40 }, { x: 84, w: 40 }, { x: 110, w: 64 }]) {
    assert.equal(sameAnchor(item, moved) && sameAnchor(moved, item), true, JSON.stringify(moved));
  }
  // A neighbour touching it on either side, or past a gap.
  for (const other of [{ x: 160, w: 40 }, { x: 80, w: 40 }, { x: 162, w: 40 }, { x: 0, w: 100 }]) {
    assert.equal(sameAnchor(item, other) || sameAnchor(other, item), false, JSON.stringify(other));
  }
  // A zero-width span overlaps nothing: not a span around it, not one it touches, not itself.
  for (const point of [{ x: 130, w: 0 }, { x: 120, w: 0 }, { x: 160, w: 0 }]) {
    assert.equal(sameAnchor(item, point) || sameAnchor(point, item) || sameAnchor(point, point), false, JSON.stringify(point));
  }
});

test("the notch keeps what each bar's panel shows", () => {
  const none: Record<string, string> = {};
  const opened = withPanel(none, { label: "taskbar", open: "timer" });
  assert.deepEqual(opened, { taskbar: "timer" });
  const switched = withPanel(opened, { label: "taskbar", open: "media" });
  assert.deepEqual(switched, { taskbar: "media" });
  // A new record each time: the store's readers compare by identity.
  assert.deepEqual([none, opened], [{}, { taskbar: "timer" }]);
  const both = withPanel(switched, { label: "taskbar-1", open: "timer" });
  assert.deepEqual(both, { taskbar: "media", "taskbar-1": "timer" });
  assert.deepEqual(withPanel(both, { label: "taskbar", open: null }), { "taskbar-1": "timer" });
  for (const bad of [{ open: "timer" }, { label: "taskbar", open: 5 }, null, "taskbar", { label: "", open: "timer" }, { label: "taskbar" }]) {
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

test("a dragged app lands in the slot under the pointer", () => {
  const slots = [100, 140, 180].map((x) => ({ x, w: 40 }));
  assert.deepEqual([90, 125, 165, 500].map((x) => dropSlot(slots, x)), [0, 1, 2, 3]);
  assert.equal(dropSlot([], 300), 0);
});

test("pinning at a slot inserts a new app and moves a pinned one", () => {
  const pin = (name: string): Favorite => ({ id: `shell:AppsFolder\\${name}`, name });
  const [A, B, C, D] = ["A", "B", "C", "D"].map(pin);
  assert.deepEqual(pinAt([A, B, C], A, 2), [B, A, C]);
  assert.deepEqual(pinAt([A, B, C], C, 0), [C, A, B]);
  assert.deepEqual(pinAt([A, B, C], B, 1), [A, B, C]);
  assert.deepEqual(pinAt([A, B, C], B, 2), [A, B, C]);
  assert.deepEqual(pinAt([A, B, C], D, 1), [A, D, B, C]);
  assert.deepEqual(pinAt([A], D, 99), [A, D]);
  // An app dragged out of Windows' list carries its fields too; a pin keeps its id and name only.
  assert.deepEqual(pinAt([A], app("D"), 0), [D, A]);
});
