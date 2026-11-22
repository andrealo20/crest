import { test } from "node:test";
import assert from "node:assert/strict";
import { BAR_TOOLS, PANEL_TOOLS, PASSWORD_ROW, QUICK_PAGE_SIZE, QUICK_SIZE, quickChips, TRASH_ARM_MS, TRAY_SIZE, dragThreshold, dropSlot, fitPanel, gridSlot, opensInBar, pageAfter, panelKey, sameAnchor, sameContent, toolPanelSize, trashArmed, trashRest, withPanel, type PanelContent, DISKS_SIZE } from "./panelModel.ts";

const tool = (id: string): PanelContent => ({ kind: "tool", tool: id });

test("the twelve widget tools open in the bar", () => {
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

test("an icon dragged in the panel lands in the slot under the pointer, row by row", () => {
  // Two rows of 40 px cells: three, then two.
  const cells = [0, 1, 2, 0, 1].map((col, i) => ({ x: 10 + col * 40, y: i < 3 ? 10 : 50, w: 40, h: 40 }));
  // Left half, right half of the first cell; the second row's first cell.
  assert.deepEqual([15, 45].map((x) => gridSlot(cells, x, 30)), [0, 1]);
  assert.equal(gridSlot(cells, 15, 70), 3);
  // Past the end of the first row: before the second row's first cell.
  assert.equal(gridSlot(cells, 300, 30), 3);
  // On the line between the rows the upper one, above them the first, past the last cell and below every row the end.
  assert.equal(gridSlot(cells, 15, 50), 0);
  assert.equal(gridSlot(cells, 15, 0), 0);
  assert.equal(gridSlot(cells, 300, 70), 5);
  assert.equal(gridSlot(cells, 15, 200), 5);
  assert.equal(gridSlot([], 15, 30), 0);
});

test("in a right-to-left panel a row runs from the right", () => {
  const cells = [0, 1, 2].map((col) => ({ x: 90 - col * 40, y: 10, w: 40, h: 40 }));
  assert.deepEqual([125, 100, 15, 0].map((x) => gridSlot(cells, x, 30, true)), [0, 1, 3, 3]);
});

test("Stato's quick panel opens in the bar's panel, apart from the tray and any tool", () => {
  assert.equal(opensInBar({ kind: "quick" }), true);
  assert.equal(panelKey({ kind: "quick" }), "quick");
  assert.equal(sameContent({ kind: "quick" }, { kind: "tray" }), false);
  assert.equal(sameContent({ kind: "quick" }, { kind: "tool", tool: "quick" }), false);
});

test("the quick panel is as tall as its rows", () => {
  // 12 px padding top and bottom, rows 56 (radios), 40 (volume), 40 (brightness), 40 (saver and airplane), 32 (footer), 10 px between rows.
  assert.deepEqual(QUICK_SIZE({ radios: true, brightness: true, list: 0, chips: 3 }), { w: 360, h: 272 });
  assert.deepEqual(QUICK_SIZE({ radios: false, brightness: false, list: 0, chips: 3 }), { w: 360, h: 156 });
  assert.equal(QUICK_SIZE({ radios: true, brightness: true, list: 90, chips: 3 }).h, 362);
  // Three chips to a row, 8 px between the rows.
  assert.equal(QUICK_SIZE({ radios: true, brightness: true, list: 0, chips: 7 }).h, 272 + 2 * 48);
  assert.equal(QUICK_SIZE({ radios: true, brightness: true, list: 0, chips: 6 }).h, 272 + 48);
});

test("the quick chips keep their order, Ethernet only on a cable and the microphone only where there is one", () => {
  assert.deepEqual(quickChips({ wired: false, mic: false }), ["saver", "airplane", "cast", "night", "dnd", "access"]);
  assert.deepEqual(quickChips({ wired: true, mic: true }), ["saver", "airplane", "ethernet", "mic", "cast", "night", "dnd", "access"]);
});

test("a quick page is as tall as its rows, six at most before it scrolls", () => {
  // 12 px padding top and bottom, the header 32, the rows 40 each (one at least), the footer 32, 10 px between the three.
  assert.deepEqual(QUICK_PAGE_SIZE(3, 0), { w: 360, h: 228 });
  assert.deepEqual(QUICK_PAGE_SIZE(0, 0), { w: 360, h: 148 });
  assert.equal(QUICK_PAGE_SIZE(10, 0).h, 348);
  assert.equal(QUICK_PAGE_SIZE(3, PASSWORD_ROW).h, 272);
});

test("the disk panel: its drives, or a scan page with a header and a footer", () => {
  // 8 px round the drives, 52 each (one at least, six at most); a scan page has the quick pages' frame round its rows instead.
  assert.deepEqual(DISKS_SIZE(3), { w: 340, h: 172 });
  assert.equal(DISKS_SIZE(0).h, 68);
  assert.equal(DISKS_SIZE(10).h, 328);
  assert.deepEqual(DISKS_SIZE(3, true), { w: 340, h: 264 });
  assert.equal(DISKS_SIZE(1, true).h, 160);
  assert.equal(DISKS_SIZE(10, true).h, 420);
});

test("a page goes back to the panel when its radio is gone, and stays while it is only off", () => {
  assert.equal(pageAfter("wifi", { wifi: false, bluetooth: true }), "wifi");
  assert.equal(pageAfter("wifi", { wifi: null, bluetooth: true }), null);
  assert.equal(pageAfter("bluetooth", { wifi: true, bluetooth: null }), null);
  assert.equal(pageAfter("bluetooth", null), "bluetooth"); // the radios are not read yet
  assert.equal(pageAfter(null, { wifi: true, bluetooth: true }), null);
  assert.equal(pageAfter("mixer", { wifi: null, bluetooth: null }), "mixer");
});

test("the six tools on saved stores open in the panel too, the half-working and notch-only ones and Find on screen in the notch", () => {
  const saved = ["notes", "todos", "water", "scratchpad", "habits", "clocks"];
  for (const id of saved) assert.equal(opensInBar(tool(id)), true, id);
  // The notch runs nothing for them: barPanels.ts reads BAR_TOOLS.
  for (const id of saved) assert.equal(BAR_TOOLS.includes(id), false, id);
  for (const id of ["clipboard", "ask", "trading", "vault", "terminal", "capture", "recorder", "camera", "calc", "convert", "launcher", "colour", "teleprompter", "agents", "find"]) assert.equal(opensInBar(tool(id)), false, id);
  assert.equal(PANEL_TOOLS.length, 18);
});

test("a widget drags past 4 px with a mouse and 10 px with touch or a pen, so a tap that opens a panel never moves it", () => {
  assert.equal(dragThreshold("mouse"), 4);
  assert.equal(dragThreshold("touch"), 10);
  assert.equal(dragThreshold("pen"), 10);
});

test("the trash arms once the pointer has rested on it 300 ms, and leaving it starts the wait over", () => {
  assert.equal(TRASH_ARM_MS, 300);
  // Onto it at 1000; a move inside keeps that time.
  let since = trashRest(null, true, 1000);
  assert.equal(since, 1000);
  since = trashRest(since, true, 1200);
  assert.equal(since, 1000);
  assert.equal(trashArmed(since, 1299), false);
  assert.equal(trashArmed(since, 1300), true);
  // Off it before the time: not armed, and back on it the wait starts again.
  since = trashRest(since, false, 1250);
  assert.equal(since, null);
  assert.equal(trashArmed(since, 5000), false);
  since = trashRest(since, true, 2000);
  assert.equal(trashArmed(since, 2299), false);
  assert.equal(trashArmed(since, 2300), true);
});
