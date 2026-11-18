import { test } from "node:test";
import assert from "node:assert/strict";
import { FIT_MARGIN, fitBar, splitApps, type Fit, type FitEntry, type FitMeasure } from "./fit.ts";

const e = (id: string, w: number, gives?: FitEntry["gives"]): FitEntry => ({ id, w, gives });
// A floating bar on a 1440 px screen (1440 - 2 * 4 - 8), Start before the apps, the Crest button on the right, apps 40 px or 30 narrow.
const bar = (o: Partial<FitMeasure> = {}): FitMeasure => ({
  inner: 1424, gap: 2, row: false, apps: "center", count: 0, full: 40, compact: 30,
  zones: { left: [], center: [e("start", 40)], right: [e("crest", 40)] },
  ...o,
});
const fit = (mode: Fit["mode"], visible: number, o: Partial<Fit> = {}): Fit => ({ mode, visible, trayBack: false, hide: [], ...o });

test("the apps keep their full size while they fit, then narrow, then the last ones go behind the button", () => {
  assert.deepEqual(fitBar(bar({ count: 30 }), null), fit("full", 30));
  assert.deepEqual(fitBar(bar({ count: 31 }), null), fit("compact", 31));
  assert.deepEqual(fitBar(bar({ count: 41 }), null), fit("overflow", 39));
});

test("the centre stays centred: the wider side zone counts twice", () => {
  const right = [e("weather", 66, "widget"), e("clock", 86, "widget"), e("crest", 40)];
  // 1424 - 2 * (68 + 88 + 42) - 42 = 986: 30 apps fit only narrow (960).
  assert.deepEqual(fitBar(bar({ count: 30, zones: { left: [], center: [e("start", 40)], right } }), null), fit("compact", 30));
});

test("apps in a side zone, or on the capsule, get all the room the other items leave", () => {
  assert.deepEqual(fitBar(bar({ count: 31, apps: "left" }), null), fit("full", 31));
  assert.deepEqual(fitBar(bar({ count: 31, row: true }), null), fit("full", 31));
});

test("a bar on another monitor, with no widgets, folds its apps the same way", () => {
  const right = [e("tray", 32, "tray"), e("tray", 32, "tray"), e("tray-more", 32), e("crest", 40)];
  assert.deepEqual(fitBar(bar({ inner: 784, count: 30, zones: { left: [], center: [e("start", 40)], right } }), null), fit("overflow", 13));
});

test("growing back takes FIT_MARGIN px more than shrinking, so a few pixels never move an app in and out", () => {
  assert.equal(FIT_MARGIN, 24);
  // 1424 - 2 * 56 - 42 = 1270: 30 full apps take 1260.
  const tight = bar({ count: 30, zones: { left: [], center: [e("start", 40)], right: [e("crest", 54)] } });
  assert.deepEqual(fitBar(tight, null), fit("full", 30));
  assert.deepEqual(fitBar(tight, fit("compact", 30)), fit("compact", 30));
  // 38 narrow apps and the button fit in 1270, 37 with the margin.
  const many = { ...tight, count: 50 };
  assert.deepEqual(fitBar(many, null), fit("overflow", 38));
  assert.deepEqual(fitBar(many, fit("overflow", 37)), fit("overflow", 37));
  assert.deepEqual(fitBar(many, fit("overflow", 39)), fit("overflow", 38));
});

test("when one app and the button do not fit, the tray's kept icons go back behind ^ first, then the widget farthest from the centre", () => {
  const right = [e("weather", 60, "widget"), e("tray", 32, "tray"), e("tray", 32, "tray"), e("tray-more", 32), e("clock", 80, "widget"), e("crest", 40)];
  const small = (inner: number) => bar({ inner, count: 10, zones: { left: [], center: [e("start", 40)], right } });
  assert.deepEqual(fitBar(small(600), null), fit("overflow", 2, { trayBack: true }));
  assert.deepEqual(fitBar(small(500), null), fit("overflow", 4, { trayBack: true, hide: ["clock"] }));
  // With the tray back 70 px are left: one app and the button (64), not FIT_MARGIN more, so a hidden clock stays hidden.
  assert.deepEqual(fitBar(small(552), null), fit("overflow", 1, { trayBack: true }));
  assert.deepEqual(fitBar(small(552), fit("overflow", 4, { trayBack: true, hide: ["clock"] })), fit("overflow", 5, { trayBack: true, hide: ["clock"] }));
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
