import { test } from "node:test";
import assert from "node:assert/strict";
import type { Favorite, LauncherApp } from "../launcher/apps.ts";
import { BAR_TOOLS, TRAY_SIZE, appRows, dropSlot, fitPanel, initialOf, opensInBar, panelKey, pinAt, sameAnchor, sameContent, toolPanelSize, withPanel, type PanelContent } from "./panelModel.ts";

const apps: PanelContent = { kind: "apps" };
const tool = (id: string): PanelContent => ({ kind: "tool", tool: id });
const app = (name: string): LauncherApp => ({ id: `shell:AppsFolder\\${name}`, name, source: "start" });

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

test("the tray panel opens in the bar and is not a tool", () => {
  assert.equal(opensInBar({ kind: "tray" }), true);
  assert.equal(panelKey({ kind: "tray" }), "tray");
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

test("the app menu lists every app under its letter", () => {
  const list = ["Affinity Photo", "Audacity", "Claude", "Cursor"].map(app);
  assert.deepEqual(appRows(list, ""), [
    { kind: "letter", letter: "A" },
    { kind: "app", app: list[0] },
    { kind: "app", app: list[1] },
    { kind: "letter", letter: "C" },
    { kind: "app", app: list[2] },
    { kind: "app", app: list[3] },
  ]);
  // Spaces alone are no search yet.
  assert.deepEqual(appRows(list, "  "), appRows(list, ""));
  assert.equal(initialOf("Ébauche"), "E");
  assert.equal(initialOf("ölfass"), "O");
  assert.equal(initialOf("7-Zip"), "#");
  assert.equal(initialOf("  zed"), "Z");
});

test("a search lists matches without letters, AI apps first", () => {
  const [calculator, claude, cursor] = ["Calculator", "Claude", "Cursor"].map(app);
  assert.deepEqual(appRows([calculator, claude, cursor], "c"), [claude, cursor, calculator].map((a) => ({ kind: "app", app: a })));
  assert.deepEqual(appRows([calculator, claude, cursor], "xyz"), []);
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
  // An app dragged out of the menu carries its list's fields too; a pin keeps its id and name only.
  assert.deepEqual(pinAt([A], app("D"), 0), [D, A]);
});
