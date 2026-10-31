import { test } from "node:test";
import assert from "node:assert/strict";
import { btAlert, netAlert, powerAlert } from "./status.ts";

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
  assert.deepEqual(powerAlert(s(true, null), s(false, null), low, tr), { kind: "power", icon: "battery", text: "Akku", tone: "normal" });
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
