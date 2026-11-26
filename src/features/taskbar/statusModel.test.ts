import { test } from "node:test";
import assert from "node:assert/strict";
import { fitIcon, HEIGHT, ICON } from "./model.ts";
import { barsGlyph, batteryGlyph, glyphSize, netGlyph, soundGlyph, statusParts, statusPill, statusWidth, wifiTile, type NetworkState } from "./statusModel.ts";

test("the network glyph is the connection in use", () => {
  const n = (p: Partial<NetworkState>): NetworkState => ({ kind: "none", wifi: true, bars: null, ssid: null, ...p });
  assert.equal(netGlyph(n({ kind: "wired" })), "wired");
  assert.equal(netGlyph(n({ kind: "wireless", bars: 5 })), "wifi-3");
  assert.equal(netGlyph(n({ kind: "wireless", bars: 4 })), "wifi-3");
  assert.equal(netGlyph(n({ kind: "wireless", bars: 3 })), "wifi-2");
  assert.equal(netGlyph(n({ kind: "wireless", bars: 2 })), "wifi-1");
  assert.equal(netGlyph(n({ kind: "wireless", bars: 0 })), "wifi-0");
  assert.equal(netGlyph(n({ kind: "wireless", bars: null })), "wifi-3");
  assert.equal(netGlyph(n({ wifi: true })), "wifi-unlinked");
  assert.equal(netGlyph(n({ wifi: false })), "wifi-off");
  assert.equal(netGlyph(n({ wifi: null })), "offline");
});

test("the volume glyph follows the level and the mute", () => {
  assert.equal(soundGlyph({ level: 40, muted: true }), "muted");
  assert.equal(soundGlyph({ level: 0, muted: false }), "muted");
  assert.equal(soundGlyph({ level: 33, muted: false }), "low");
  assert.equal(soundGlyph({ level: 34, muted: false }), "mid");
  assert.equal(soundGlyph({ level: 67, muted: false }), "high");
  assert.equal(soundGlyph(null), null);
});

test("a PC without a battery draws none", () => {
  const p = { ac: false, percent: 80, battery: true, charging: false };
  assert.equal(batteryGlyph({ ...p, battery: false, percent: null }), null);
  assert.equal(batteryGlyph(null), null);
  assert.equal(batteryGlyph({ ...p, charging: true }), "charging");
  assert.equal(batteryGlyph({ ...p, percent: 90 }), "full");
  assert.equal(batteryGlyph({ ...p, percent: 60 }), "high");
  assert.equal(batteryGlyph({ ...p, percent: 30 }), "medium");
  assert.equal(batteryGlyph({ ...p, percent: 10 }), "low");
  assert.equal(batteryGlyph({ ...p, percent: 9 }), "warning");
  assert.equal(batteryGlyph({ ...p, percent: 9, ac: true }), "low");
});

test("the name says each state, with the percentages", () => {
  assert.deepEqual(
    statusParts({ network: { kind: "wireless", wifi: true, bars: 4, ssid: "Home" }, sound: { level: 40, muted: false }, power: { ac: true, percent: 80, battery: true, charging: true } }),
    [["WLAN: {name}", { name: "Home" }], ["Lautstärke {p} %", { p: 40 }], ["Akku {p} %, lädt", { p: 80 }]],
  );
  assert.deepEqual(statusParts({ network: { kind: "wired", wifi: null, bars: null, ssid: null }, sound: { level: 10, muted: true }, power: null }), [["Ethernet"], ["Stummgeschaltet"]]);
  assert.deepEqual(statusParts({ network: { kind: "wireless", wifi: true, bars: 2, ssid: null }, sound: null, power: { ac: false, percent: 55, battery: true, charging: false } }), [["WLAN"], ["Akku {p} %", { p: 55 }]]);
  assert.deepEqual(statusParts({ network: { kind: "none", wifi: false, bars: null, ssid: null }, sound: null, power: null }), [["WLAN aus"]]);
  assert.deepEqual(statusParts({ network: { kind: "none", wifi: true, bars: null, ssid: null }, sound: null, power: null }), [["Nicht verbunden"]]);
  assert.deepEqual(statusParts({ network: { kind: "none", wifi: null, bars: null, ssid: null }, sound: null, power: null }), [["Keine Verbindung"]]);
  assert.deepEqual(statusParts({ network: null, sound: null, power: { ac: false, percent: 63, battery: true, charging: false, saver: true } }), [["Akku {p} %", { p: 63 }]]);
  assert.deepEqual(statusParts({ network: null, sound: null, power: null }), []);
});

test("the glyphs are two thirds of the icon and the item as wide as they are, 6 px apart with the pill's sides", () => {
  assert.equal(glyphSize(24), 16);
  assert.equal(glyphSize(20), 13);
  assert.equal(statusWidth(24, 3, true, 44), 90);
  assert.equal(statusWidth(24, 3, false, 44), 80);
  assert.equal(statusWidth(24, 2, false, 44), 58);
  assert.equal(statusWidth(24, 1, true, 44), 46);
  assert.equal(statusWidth(20, 3, true, 32), 74);
});

test("on Tiles Stato has no pill: its glyphs 4 px apart with the 8 px a bar button keeps on each side", () => {
  assert.equal(statusWidth(24, 3, true, null), 82);
  assert.equal(statusWidth(24, 3, false, null), 72);
  assert.equal(statusWidth(24, 2, false, null), 52);
  assert.equal(statusWidth(24, 1, true, null), 42);
  assert.equal(statusWidth(20, 3, true, null), 72);
});

test("Stato's pill sits a little below the bar's height, on whole pixels, with room round the glyphs at every size", () => {
  assert.deepEqual(statusPill(32), { height: 22, pad: 7 });
  assert.deepEqual(statusPill(44), { height: 30, pad: 10 });
  assert.deepEqual(statusPill(64), { height: 44, pad: 15 });
  for (let h = HEIGHT[0]; h <= HEIGHT[1]; h++) {
    const pill = statusPill(h);
    assert.equal(pill.height % 2, 0, `even at ${h}`);
    assert.ok(pill.height <= h - 8, `below the bar at ${h}`);
    for (let icon = ICON[0]; icon <= ICON[1]; icon++) assert.ok(pill.height >= glyphSize(fitIcon(h, icon)) + 8, `round the glyphs at ${h}, ${icon}`);
  }
});

test("the quick panel's Wi-Fi tile says only On or Off while a cable carries the internet", () => {
  const n = (p: Partial<NetworkState>): NetworkState => ({ kind: "none", wifi: true, bars: null, ssid: null, ...p });
  assert.deepEqual(wifiTile(true, n({ kind: "wired" })), { key: "An", ssid: null });
  assert.deepEqual(wifiTile(false, n({ kind: "wired", wifi: false })), { key: "Aus", ssid: null });
  assert.deepEqual(wifiTile(true, n({ kind: "wireless", bars: 3, ssid: "Lab" })), { key: "Verbunden", ssid: "Lab" });
  assert.deepEqual(wifiTile(true, n({ kind: "wireless" })), { key: "Verbunden", ssid: null });
  assert.deepEqual(wifiTile(true, n({})), { key: "Nicht verbunden", ssid: null });
  assert.deepEqual(wifiTile(false, n({ wifi: false })), { key: "Aus", ssid: null });
  assert.deepEqual(wifiTile(true, null), { key: "Nicht verbunden", ssid: null });
});

test("a network's bars give the fan's level, four or more a full fan", () => {
  assert.equal(barsGlyph(5), "wifi-3");
  assert.equal(barsGlyph(4), "wifi-3");
  assert.equal(barsGlyph(3), "wifi-2");
  assert.equal(barsGlyph(1), "wifi-1");
  assert.equal(barsGlyph(0), "wifi-0");
  assert.equal(barsGlyph(null), "wifi-3");
});
