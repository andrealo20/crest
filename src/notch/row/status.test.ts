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
});
