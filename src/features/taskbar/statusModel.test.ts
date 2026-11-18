import { test } from "node:test";
import assert from "node:assert/strict";
import { batteryGlyph, glyphSize, netGlyph, soundGlyph, statusParts, statusWidth, wifiTile, type NetworkState } from "./statusModel.ts";

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
  assert.deepEqual(statusParts({ network: { kind: "wired", wifi: null, bars: null, ssid: null }, sound: { level: 10, muted: true }, power: null }), [["Ethernet"], ["Stumm"]]);
  assert.deepEqual(statusParts({ network: { kind: "wireless", wifi: true, bars: 2, ssid: null }, sound: null, power: { ac: false, percent: 55, battery: true, charging: false } }), [["WLAN"], ["Akku {p} %", { p: 55 }]]);
  assert.deepEqual(statusParts({ network: { kind: "none", wifi: false, bars: null, ssid: null }, sound: null, power: null }), [["WLAN aus"]]);
  assert.deepEqual(statusParts({ network: { kind: "none", wifi: true, bars: null, ssid: null }, sound: null, power: null }), [["Nicht verbunden"]]);
  assert.deepEqual(statusParts({ network: { kind: "none", wifi: null, bars: null, ssid: null }, sound: null, power: null }), [["Keine Verbindung"]]);
  assert.deepEqual(statusParts({ network: null, sound: null, power: null }), []);
});

test("the glyphs are two thirds of the icon and the item as wide as they are", () => {
  assert.equal(glyphSize(24), 16);
  assert.equal(glyphSize(20), 13);
  assert.equal(statusWidth(24, 3), 72);
  assert.equal(statusWidth(24, 2), 52);
  assert.equal(statusWidth(20, 3), 63);
});

test("the quick panel's Wi-Fi tile says only On or Off while a cable carries the internet", () => {
  const n = (p: Partial<NetworkState>): NetworkState => ({ kind: "none", wifi: true, bars: null, ssid: null, ...p });
  assert.deepEqual(wifiTile(true, n({ kind: "wired" })), { key: "An", ssid: null, glyph: null });
  assert.deepEqual(wifiTile(false, n({ kind: "wired", wifi: false })), { key: "Aus", ssid: null, glyph: null });
  assert.deepEqual(wifiTile(true, n({ kind: "wireless", bars: 3, ssid: "Lab" })), { key: "Verbunden", ssid: "Lab", glyph: "wifi-2" });
  assert.deepEqual(wifiTile(true, n({ kind: "wireless" })), { key: "Verbunden", ssid: null, glyph: "wifi-3" });
  assert.deepEqual(wifiTile(true, n({})), { key: "Nicht verbunden", ssid: null, glyph: "wifi-unlinked" });
  assert.deepEqual(wifiTile(false, n({ wifi: false })), { key: "Aus", ssid: null, glyph: "wifi-off" });
  assert.deepEqual(wifiTile(true, null), { key: "Nicht verbunden", ssid: null, glyph: null });
});
