import { test } from "node:test";
import assert from "node:assert/strict";
import { BAR_TOOLS, QUICK_SIZE, TRAY_SIZE, dropSlot, fitPanel, opensInBar, panelKey, sameAnchor, sameContent, toolPanelSize, withPanel, type PanelContent } from "./panelModel.ts";

const tool = (id: string): PanelContent => ({ kind: "tool", tool: id });

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

test("the tray panel opens in the bar and is not a tool", () => {
  assert.equal(opensInBar({ kind: "tray" }), true);
  assert.equal(panelKey({ kind: "tray" }), "tray");
  // A tool known by the id "tray" is still a tool: the kind counts too.
  assert.equal(sameContent({ kind: "tray" }, tool("tray")), false);
  assert.equal(sameContent({ kind: "tray" }, { kind: "tray" }), true);
});

test("the apps behind … open in the bar's panel, apart from the tray and any tool", () => {
  assert.equal(opensInBar({ kind: "apps" }), true);
  assert.equal(panelKey({ kind: "apps" }), "apps");
  assert.equal(sameContent({ kind: "apps" }, { kind: "tray" }), false);
  assert.equal(sameContent({ kind: "apps" }, { kind: "tool", tool: "apps" }), false);
});

test("the tray panel grows a row for every five icons, up to four rows, then scrolls", () => {
  // Five buttons as wide as the bar's (icon + 16) and 12 px round them; one row for the line it shows without icons.
  assert.deepEqual(TRAY_SIZE(24, 0), { w: 224, h: 64 });
  assert.deepEqual(TRAY_SIZE(24, 5), { w: 224, h: 64 });
  assert.deepEqual(TRAY_SIZE(24, 6), { w: 224, h: 104 });
  assert.deepEqual(TRAY_SIZE(24, 40), { w: 224, h: 184 });
  assert.deepEqual(TRAY_SIZE(16, 40), { w: 184, h: 152 });
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

test("a dragged icon lands in the slot under the pointer", () => {
  const slots = [100, 140, 180].map((x) => ({ x, w: 40 }));
  assert.deepEqual([90, 125, 165, 500].map((x) => dropSlot(slots, x)), [0, 1, 2, 3]);
  assert.equal(dropSlot([], 300), 0);
});

test("Stato's quick panel opens in the bar's panel, apart from the tray and any tool", () => {
  assert.equal(opensInBar({ kind: "quick" }), true);
  assert.equal(panelKey({ kind: "quick" }), "quick");
  assert.equal(sameContent({ kind: "quick" }, { kind: "tray" }), false);
  assert.equal(sameContent({ kind: "quick" }, { kind: "tool", tool: "quick" }), false);
});

test("the quick panel is as tall as its rows", () => {
  // 12 px padding top and bottom, rows 56 (radios), 40 (volume), 40 (brightness), 40 (saver and airplane), 32 (footer), 10 px between rows.
  assert.deepEqual(QUICK_SIZE({ radios: true, brightness: true, list: 0 }), { w: 360, h: 272 });
  assert.deepEqual(QUICK_SIZE({ radios: false, brightness: false, list: 0 }), { w: 360, h: 156 });
  assert.equal(QUICK_SIZE({ radios: true, brightness: true, list: 90 }).h, 362);
});
