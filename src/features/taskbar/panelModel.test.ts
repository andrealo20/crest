import { test } from "node:test";
import assert from "node:assert/strict";
import { BAR_TOOLS, CLOCK_CALENDAR, PANEL_TOOLS, PASSWORD_ROW, QUICK_PAGE_SIZE, QUICK_SIZE, quickChips, TRAY_SIZE, dragThreshold, dropSlot, fitClock, fitPanel, gridSlot, opensInBar, pageAfter, panelKey, reportedTool, sameAnchor, sameContent, toolPanelSize, withPanel, type PanelContent } from "./panelModel.ts";

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

test("the main bar's clock opens a panel of its own in the bar, Crest's notices over its calendar", () => {
  const clock: PanelContent = { kind: "clock" };
  assert.equal(opensInBar(clock), true);
  assert.equal(panelKey(clock), "clock");
  assert.equal(sameContent(clock, { kind: "clock" }), true);
  // Not the calendar's own panel, which the Next event widget opens, nor a tool named "clock".
  assert.equal(sameContent(clock, tool("calendar")), false);
  assert.equal(sameContent(clock, tool("clock")), false);
});

test("the clock's panel has the notch send the calendar and the notices, as a tool's does", () => {
  assert.equal(reportedTool({ kind: "clock" }), "calendar");
  assert.ok(BAR_TOOLS.includes(reportedTool({ kind: "clock" })!));
  assert.equal(reportedTool(tool("media")), "media");
  for (const c of [{ kind: "tray" }, { kind: "apps" }, { kind: "quick" }, { kind: "disks" }] as PanelContent[]) assert.equal(reportedTool(c), null, c.kind);
  assert.equal(reportedTool(undefined), null);
});

test("the clock's panel keeps the calendar as tall as its own panel and shows it alone where the notices would get under 120 px", () => {
  // The Calendar tool's notch size (tabs.ts), less the notch's tool bar.
  assert.deepEqual(CLOCK_CALENDAR, toolPanelSize({ w: 560, h: 340 }));
  const room = { w: 1904, h: 568 };
  assert.deepEqual(fitClock(room, 1), { size: { w: 560, h: 514 }, alone: false });
  // 454 px: the calendar's 294 and 160 for the notices.
  assert.deepEqual(fitClock(room, 1.25), { size: { w: 560, h: 454 }, alone: false });
  // 378 px would leave the notices 84: the calendar alone, whole.
  assert.deepEqual(fitClock(room, 1.5), { size: { w: 560, h: 294 }, alone: true });
  // Too short even for the calendar alone: fitted as the calendar's own panel is.
  assert.deepEqual(fitClock({ w: 1350, h: 512 }, 2), { size: { w: 560, h: 256 }, alone: true });
  assert.equal(fitClock({ w: 1904, h: 414 }, 1).alone, false);
  assert.equal(fitClock({ w: 1904, h: 413 }, 1).alone, true);
});

test("a widget drags past 4 px with a mouse and 10 px with touch or a pen, so a tap that opens a panel never moves it", () => {
  assert.equal(dragThreshold("mouse"), 4);
  assert.equal(dragThreshold("touch"), 10);
  assert.equal(dragThreshold("pen"), 10);
});
