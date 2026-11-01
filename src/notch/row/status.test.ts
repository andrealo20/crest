import { test } from "node:test";
import assert from "node:assert/strict";
import { btAlert, levelAlert, mergeSeed, netAlert, osdHidden, powerAlert } from "./status.ts";

const tr = (k: string, v: Record<string, string | number> = {}) => k.replace(/\{(\w+)\}/g, (_, x) => String(v[x]));
const s = (ac: boolean, percent: number | null, battery = true) => ({ ac, percent, battery });

test("power", () => {
  const low = { warned20: false, warned10: false };
  assert.equal(powerAlert(null, s(true, 64), low, tr), null);
  assert.deepEqual(powerAlert(s(true, 64), s(false, 64), low, tr), { kind: "power", icon: "battery", text: "Akku · 64 %", tone: "normal" });
  assert.equal(powerAlert(s(false, 64), s(false, 63), low, tr), null);
  assert.equal(powerAlert(s(false, 21), s(false, 20), low, tr)?.tone, "warning");
  assert.equal(powerAlert(s(false, 20), s(false, 19), low, tr), null);
  assert.equal(powerAlert(s(false, 11), s(false, 10), low, tr)?.tone, "critical");
  assert.equal(powerAlert(s(false, 10), s(true, 10), low, tr)?.text, "Lädt · 10 %");
  assert.deepEqual(low, { warned20: false, warned10: false });
  assert.equal(powerAlert(s(true, 50, false), s(false, 50, false), low, tr), null);
});
test("power: unplugging low takes the low tone at once", () => {
  const low = { warned20: false, warned10: false };
  assert.deepEqual(powerAlert(s(true, 18), s(false, 18), low, tr), { kind: "power", icon: "battery", text: "Akku · 18 %", tone: "warning" });
  assert.equal(powerAlert(s(false, 18), s(false, 17), low, tr), null);
  assert.equal(powerAlert(s(false, 11), s(false, 10), low, tr)?.tone, "critical");
  assert.equal(powerAlert(s(true, 8), s(false, 8), { warned20: false, warned10: false }, tr)?.tone, "critical");
});
test("power: a first state already low is silent for that level", () => {
  const low = { warned20: false, warned10: false };
  assert.equal(powerAlert(null, s(false, 15), low, tr), null);
  assert.deepEqual(low, { warned20: true, warned10: false });
  assert.equal(powerAlert(s(false, 15), s(false, 14), low, tr), null);
  assert.equal(powerAlert(s(false, 11), s(false, 10), low, tr)?.tone, "critical");
});
test("power: a jump from 25 to 9 gives one critical and no later warning", () => {
  const low = { warned20: false, warned10: false };
  assert.equal(powerAlert(s(false, 25), s(false, 9), low, tr)?.tone, "critical");
  assert.equal(powerAlert(s(false, 9), s(false, 8), low, tr), null);
  assert.equal(powerAlert(s(false, 8), s(false, 20), low, tr), null);
});
test("power: the warning fires again after plugging in", () => {
  const low = { warned20: false, warned10: false };
  assert.equal(powerAlert(s(false, 21), s(false, 20), low, tr)?.tone, "warning");
  assert.equal(powerAlert(s(false, 20), s(true, 20), low, tr)?.icon, "plug");
  assert.equal(powerAlert(s(true, 30), s(false, 30), low, tr)?.tone, "normal");
  assert.equal(powerAlert(s(false, 21), s(false, 20), low, tr)?.tone, "warning");
});
test("power: plug and unplug without a percent", () => {
  const low = { warned20: false, warned10: false };
  assert.deepEqual(powerAlert(s(false, null), s(true, null), low, tr), { kind: "power", icon: "plug", text: "Lädt", tone: "normal" });
  assert.deepEqual(powerAlert(s(true, null), s(false, null), low, tr), { kind: "power", icon: "battery", text: "Am Akku", tone: "normal" });
  assert.equal(powerAlert(s(false, null), s(false, null), low, tr), null);
});
test("net", () => {
  assert.equal(netAlert(null, false, tr), null);
  assert.equal(netAlert(true, false, tr)?.icon, "wifi-off");
  assert.equal(netAlert(false, true, tr)?.text, "Online");
  assert.equal(netAlert(true, true, tr), null);
});
test("bt", () => {
  assert.equal(btAlert({ name: "Buds", connected: true, battery: 80 }, tr)?.text, "Buds · 80 %");
  assert.equal(btAlert({ name: "Buds", connected: true, battery: null }, tr)?.text, "Buds");
  assert.equal(btAlert({ name: "Buds", connected: false, battery: null }, tr)?.text, "Buds · Getrennt");
  assert.equal(btAlert({ name: "  ", connected: true, battery: 50 }, tr), null);
  assert.equal(btAlert({ name: "", connected: false, battery: null }, tr), null);
});

test("seed: fills only what is still unknown", () => {
  const none = { power: null, online: null, headsets: new Set<string>() };
  // A partial seed (registration still running), then the complete one.
  const partial = mergeSeed(none, { power: s(true, 64), online: null, headsets: [] });
  const full = mergeSeed(partial, { power: s(true, 64), online: true, headsets: ["Buds"] });
  assert.deepEqual(full, { power: s(true, 64), online: true, headsets: new Set(["Buds"]) });
  // An event before any seed stays; a seed after an event does not overwrite it.
  const evented = mergeSeed({ power: s(false, 40), online: false, headsets: new Set<string>() }, { power: s(true, 64), online: true, headsets: [] });
  assert.deepEqual([evented.power, evented.online], [s(false, 40), false]);
  // Headsets are the union of what is known and what the seed lists.
  assert.deepEqual(mergeSeed({ ...none, headsets: new Set(["A"]) }, { power: null, online: null, headsets: ["A", "B"] }).headsets, new Set(["A", "B"]));
});

test("level: volume icon, bar and text", () => {
  const v = (level: number, muted = false) => levelAlert({ kind: "volume", level, muted }, tr);
  assert.deepEqual(v(64), { kind: "volume", icon: "speaker-high", text: "64 %", tone: "normal", level: 64 });
  assert.equal(v(49).icon, "speaker-low");
  assert.equal(v(50).icon, "speaker-high");
  assert.deepEqual([v(0).icon, v(0).text], ["speaker-none", "0 %"]);
  // Muted keeps the level for the bar and says so instead of the percent.
  assert.deepEqual(v(30, true), { kind: "volume", icon: "speaker-x", text: "Stummgeschaltet", tone: "normal", level: 30 });
});
test("level: brightness and out of range readings", () => {
  const b = (level: number) => levelAlert({ kind: "brightness", level, muted: false }, tr);
  assert.deepEqual(b(80), { kind: "brightness", icon: "sun", text: "80 %", tone: "normal", level: 80 });
  assert.equal(b(20).icon, "sun-dim");
  assert.equal(b(140).level, 100);
  assert.equal(b(-5).level, 0);
  assert.equal(b(33.6).text, "34 %");
});
test("osd: hidden only while the HUD replaces both and can show", () => {
  const on = { volume: true, brightness: true, hideOsd: true };
  assert.equal(osdHidden(on, false, false), true);
  assert.equal(osdHidden({ ...on, hideOsd: false }, false, false), false);
  assert.equal(osdHidden({ ...on, brightness: false }, false, false), false);
  assert.equal(osdHidden({ ...on, volume: false }, false, false), false);
  assert.equal(osdHidden(on, true, false), false);
  assert.equal(osdHidden(on, false, true), false);
});
