import { test } from "node:test";
import assert from "node:assert/strict";
import { FIT_MARGIN, fitBar, splitApps, type Fit, type FitEntry, type FitMeasure } from "./fit.ts";

const e = (id: string, w: number, gives?: FitEntry["gives"]): FitEntry => ({ id, w, gives });
// A floating bar on a 1440 px screen (1440 - 2 * 4 - 8), Start before the apps, the Crest button on the right, apps 40 px or 30 narrow.
const bar = (o: Partial<FitMeasure> = {}): FitMeasure => ({
  inner: 1424, gap: 2, row: false, apps: "center", count: 0, full: 40, compact: 30, split: null,
  zones: { left: [], center: [e("start", 40)], right: [e("crest", 40)] },
  ...o,
});
const fit = (mode: Fit["mode"], visible: number, o: Partial<Fit> = {}): Fit => ({ mode, visible, trayBack: false, hide: [], split: false, label: 0, ...o });

test("the apps keep their full size while they fit, then narrow, then the last ones go behind the button", () => {
  // 1424 - 40 (Start) - 40 (Crest) = 1344: 32 full apps take 1344, 42 narrow 1344, 43 do not.
  assert.deepEqual(fitBar(bar({ count: 32 }), null), fit("full", 32));
  assert.deepEqual(fitBar(bar({ count: 33 }), null), fit("compact", 33));
  assert.deepEqual(fitBar(bar({ count: 43 }), null), fit("overflow", 41));
});

test("the centre moves aside before its apps fold: each side counts once, so the apps go behind the button only when the bar is full", () => {
  const right = [e("weather", 66, "widget"), e("clock", 86, "widget"), e("crest", 40)];
  // 1424 - (66 + 2 + 86 + 2 + 40) - 40 = 1188: 28 full apps take 1176.
  assert.deepEqual(fitBar(bar({ count: 28, zones: { left: [], center: [e("start", 40)], right } }), null), fit("full", 28));
  // A wide left zone, Crest alone on the right: counted twice it left 116 px, two apps and "…"; once, all five fit in full.
  const left = [e("rings", 300, "widget"), e("sys:searchbox", 130, "widget"), e("weather", 200, "widget")];
  assert.deepEqual(fitBar(bar({ count: 5, zones: { left, center: [e("start", 40)], right: [e("crest", 40)] } }), null), fit("full", 5));
});

test("apps in a side zone, or on the capsule, get all the room the other items leave", () => {
  assert.deepEqual(fitBar(bar({ count: 31, apps: "left" }), null), fit("full", 31));
  assert.deepEqual(fitBar(bar({ count: 31, row: true }), null), fit("full", 31));
});

test("a bar on another monitor, with no widgets, folds its apps the same way", () => {
  const right = [e("tray", 32, "tray"), e("tray", 32, "tray"), e("tray-more", 32), e("crest", 40)];
  assert.deepEqual(fitBar(bar({ inner: 784, count: 30, zones: { left: [], center: [e("start", 40)], right } }), null), fit("overflow", 17));
});

test("growing back takes FIT_MARGIN px more than shrinking, so a few pixels never move an app in and out", () => {
  assert.equal(FIT_MARGIN, 24);
  // 1424 - 40 - 114 = 1270: 30 full apps take 1260.
  const tight = bar({ count: 30, zones: { left: [], center: [e("start", 40)], right: [e("crest", 114)] } });
  assert.deepEqual(fitBar(tight, null), fit("full", 30));
  assert.deepEqual(fitBar(tight, fit("compact", 30)), fit("compact", 30));
  // 38 narrow apps and the button fit in 1270, 37 with the margin.
  const many = { ...tight, count: 50 };
  assert.deepEqual(fitBar(many, null), fit("overflow", 38));
  assert.deepEqual(fitBar(many, fit("overflow", 37)), fit("overflow", 37));
  assert.deepEqual(fitBar(many, fit("overflow", 39)), fit("overflow", 38));
});

test("the fit is exact: the items in a row take their widths and one gap fewer than their number", () => {
  // A docked bar, 6 px between items: 66 + 6 + 86 + 6 + 40 = 204 on the right, Start and 12 full apps 40 + 12 * (6 + 40) in the centre.
  const right = [e("weather", 66, "widget"), e("clock", 86, "widget"), e("crest", 40)];
  const docked = (inner: number, count: number) => bar({ inner, gap: 6, count, zones: { left: [], center: [e("start", 40)], right } });
  assert.deepEqual(fitBar(docked(204 + 40 + 12 * 46, 12), null), fit("full", 12));
  assert.deepEqual(fitBar(docked(204 + 40 + 12 * 46 - 1, 12), null), fit("compact", 12));
  // 14 narrow apps and "…" take 15 * 36 = 540 of the 552 left, 15 would take 576.
  assert.deepEqual(fitBar(docked(204 + 40 + 12 * 46, 20), null), fit("overflow", 14));
  // Apps in a side zone, after Start: 40 + 12 * 46 there, and the right zone once.
  const side = (inner: number) => bar({ inner, gap: 6, count: 12, apps: "left", zones: { left: [e("start", 40)], center: [], right } });
  assert.deepEqual(fitBar(side(40 + 12 * 46 + 204), null), fit("full", 12));
  assert.deepEqual(fitBar(side(40 + 12 * 46 + 204 - 1), null), fit("compact", 12));
  // The capsule: one row, so the gap between two zones counts once.
  const row = (inner: number) => bar({ inner, gap: 6, count: 12, row: true, zones: { left: [], center: [e("start", 40)], right } });
  assert.deepEqual(fitBar(row(40 + 12 * 46 + 6 + 204), null), fit("full", 12));
  assert.deepEqual(fitBar(row(40 + 12 * 46 + 6 + 204 - 1), null), fit("compact", 12));
  // Without apps a widget leaves only when the items alone do not fit; never the clock.
  const none = (inner: number) => bar({ inner, gap: 6, apps: null, zones: { left: [], center: [], right } });
  assert.deepEqual(fitBar(none(204), null), fit("full", 0));
  assert.deepEqual(fitBar(none(204 - 1), null), fit("full", 0, { hide: ["weather"] }));
});

test("when one app and the button do not fit, the tray's kept icons go back behind ^ first, then the widget farthest from the centre", () => {
  const right = [e("weather", 60, "widget"), e("tray", 32, "tray"), e("tray", 32, "tray"), e("tray-more", 32), e("timer", 80, "widget"), e("crest", 40)];
  const small = (inner: number) => bar({ inner, count: 10, zones: { left: [], center: [e("start", 40)], right } });
  // 286 px on the right, 218 with the tray back, 136 without the timer too; Start takes 40.
  assert.deepEqual(fitBar(small(370), null), fit("overflow", 2, { trayBack: true }));
  assert.deepEqual(fitBar(small(320), null), fit("overflow", 3, { trayBack: true, hide: ["timer"] }));
  // With the tray back 76 px are left: one app and the button (64), not FIT_MARGIN more, so a hidden timer stays hidden.
  assert.deepEqual(fitBar(small(334), null), fit("overflow", 1, { trayBack: true }));
  assert.deepEqual(fitBar(small(334), fit("overflow", 2, { trayBack: true, hide: ["timer"] })), fit("overflow", 3, { trayBack: true, hide: ["timer"] }));
});

test("the clock never hides: the other widgets go first, the outermost first", () => {
  // 40 + 6 + 66 + 6 + 86 + 6 + 40 = 250 on the right, the clock the outermost widget.
  const right = [e("timer", 40, "widget"), e("weather", 66, "widget"), e("clock", 86, "widget"), e("crest", 40)];
  const none = (inner: number) => bar({ inner, gap: 6, apps: null, zones: { left: [], center: [], right } });
  assert.deepEqual(fitBar(none(250), null), fit("full", 0));
  assert.deepEqual(fitBar(none(250 - 1), null), fit("full", 0, { hide: ["weather"] }));
  // Without the weather 178, without the timer too 132.
  assert.deepEqual(fitBar(none(178 - 1), null), fit("full", 0, { hide: ["weather", "timer"] }));
  assert.deepEqual(fitBar(none(100), null), fit("full", 0, { hide: ["weather", "timer"] }));
});

test("the button that shows the hidden items takes room of its own, in the first hidden item's place, so one more may hide for it", () => {
  const right = [e("timer", 40, "widget"), e("weather", 66, "widget"), e("clock", 86, "widget"), e("crest", 40)];
  const none = (inner: number, more?: number) => bar({ inner, gap: 6, apps: null, more, zones: { left: [], center: [], right } });
  // Nothing hidden, no button.
  assert.deepEqual(fitBar(none(250, 40), null), fit("full", 0));
  // The weather gone and the button (40) in its place: 40 + 6 + 40 + 6 + 86 + 6 + 40 = 224 on the right, 178 without the button.
  assert.deepEqual(fitBar(none(224, 40), null), fit("full", 0, { hide: ["weather"] }));
  assert.deepEqual(fitBar(none(224 - 1, 40), null), fit("full", 0, { hide: ["weather", "timer"] }));
  assert.deepEqual(fitBar(none(224 - 1), null), fit("full", 0, { hide: ["weather"] }));
  // The capsule: one row, the button in it once.
  const row = (inner: number) => bar({ inner, gap: 6, apps: null, row: true, more: 40, zones: { left: [], center: [], right } });
  assert.deepEqual(fitBar(row(224), null), fit("full", 0, { hide: ["weather"] }));
  assert.deepEqual(fitBar(row(223), null), fit("full", 0, { hide: ["weather", "timer"] }));
});

test("an item gives way to the button only when that leaves more room, or the bar would be tighter for nothing", () => {
  const narrow = (first: FitEntry, inner: number, more?: number) =>
    bar({ inner, count: 20, more, zones: { left: [], center: [e("start", 40)], right: [first, e("clock", 86, "widget"), e("crest", 40)] } });
  // 238 - (32 + 2 + 86 + 2 + 40) - 40 = 36: a Calc button gone gives 34, room for one app and "…", but the button (32) in its place takes it back.
  const calc = e("tool:calc", 32, "widget");
  assert.deepEqual(fitBar(narrow(calc, 238), null), fit("overflow", 1, { hide: ["tool:calc"] }));
  assert.deepEqual(fitBar(narrow(calc, 238, 32), null), fit("overflow", 1));
  // Show desktop's 12 px strip: the button would leave 20 px less than keeping it.
  assert.deepEqual(fitBar(narrow(e("sys:desktop", 12, "widget"), 238, 32), null), fit("overflow", 1));
});

// One button per window: `count` of them, `titled` with a window, titles 96 to 168 px wide.
const split = (count: number, titled: number, never: boolean): FitMeasure["split"] => ({ count, titled, min: 96, max: 168, never });

test("never: titles while they fit, as wide as max, then narrower to an exact width, then icons one per window", () => {
  // 1424 - 40 - 40 = 1344 for the apps.
  assert.deepEqual(fitBar(bar({ count: 3, split: split(5, 5, true) }), null), fit("labels", 5, { split: true, label: 168 }));
  // floor(1344 / 10) - 2 = 132.
  assert.deepEqual(fitBar(bar({ count: 3, split: split(10, 10, true) }), null), fit("labels", 10, { split: true, label: 132 }));
  // 13 titles at 96 + 2 take 1274: with 1274 they fit at 96, one px less and the windows turn into icons.
  assert.deepEqual(fitBar(bar({ inner: 1274 + 80, count: 3, split: split(13, 13, true) }), null), fit("labels", 13, { split: true, label: 96 }));
  assert.deepEqual(fitBar(bar({ inner: 1273 + 80, count: 3, split: split(13, 13, true) }), null), fit("full", 13, { split: true }));
});

test("pinned apps with no window keep an icon's width beside titles", () => {
  // Two icons take 2 * 42 first: floor((1344 - 84) / 10) - 2 = 124.
  assert.deepEqual(fitBar(bar({ count: 5, split: split(12, 10, true) }), null), fit("labels", 12, { split: true, label: 124 }));
});

test("never folds one window at a time, counted in window buttons", () => {
  // 43 narrow window buttons take 1376 of the 1344: 41 and "…".
  assert.deepEqual(fitBar(bar({ count: 3, split: split(43, 43, true) }), null), fit("overflow", 41, { split: true }));
});

test("when full: titles, then one button per app, titles coming back FIT_MARGIN px later", () => {
  assert.deepEqual(fitBar(bar({ count: 5, split: split(20, 20, false) }), null), fit("full", 5));
  // 13 titles need 1274, and 1298 coming back from the combined bar.
  const room = (r: number) => bar({ inner: r + 80, count: 5, split: split(13, 13, false) });
  assert.deepEqual(fitBar(room(1297), null), fit("labels", 13, { split: true, label: 97 }));
  assert.deepEqual(fitBar(room(1297), fit("full", 5)), fit("full", 5));
  assert.deepEqual(fitBar(room(1298), fit("full", 5)), fit("labels", 13, { split: true, label: 96 }));
});

test("from titles to icons takes no margin", () => {
  // 31 icons take 1302 of the 1344.
  assert.deepEqual(fitBar(bar({ count: 3, split: split(31, 31, true) }), fit("labels", 20, { split: true, label: 96 })), fit("full", 31, { split: true }));
});

test("a widget never hides for titles", () => {
  // 272 - (86 + 2 + 40) - 40 = 104: two icons fit, two titles (196) only with the clock gone.
  const right = [e("clock", 86, "widget"), e("crest", 40)];
  assert.deepEqual(fitBar(bar({ inner: 272, count: 1, zones: { left: [], center: [e("start", 40)], right }, split: split(2, 2, true) }), null), fit("full", 2, { split: true }));
});

test("the last apps go first, and the app in front and those asking for attention take the last places shown", () => {
  const keys = ["a", "b", "c", "d", "e"];
  assert.deepEqual(splitApps(keys, 3, []), { shown: ["a", "b", "c"], hidden: ["d", "e"] });
  assert.deepEqual(splitApps(keys, 3, ["e"]), { shown: ["a", "b", "e"], hidden: ["c", "d"] });
  assert.deepEqual(splitApps(keys, 3, ["b"]), { shown: ["a", "b", "c"], hidden: ["d", "e"] });
  assert.deepEqual(splitApps(keys, 3, ["e", "d"]), { shown: ["a", "d", "e"], hidden: ["b", "c"] });
  assert.deepEqual(splitApps(keys, 1, ["e", "d", "e"]), { shown: ["e"], hidden: ["a", "b", "c", "d"] });
  assert.deepEqual(splitApps(keys, 5, ["e"]), { shown: keys, hidden: [] });
});
