import { test } from "node:test";
import assert from "node:assert/strict";
import { CLOSED_DEFAULTS, PART_IDS, normalizeClosed, normalizePet, partTool, trackCaption } from "./parts.ts";

test("defaults and upgrade", () => {
  assert.deepEqual(normalizeClosed(undefined), CLOSED_DEFAULTS);
  const n = normalizeClosed({ order: ["clock", "bogus", "rings"], parts: { clock: true }, readings: { gpu: false } });
  assert.deepEqual(n.order, ["clock", "rings", "timer", "discord", "title", "readings", "equalizer", "github", "calendar", "script", "downloads", "weather"]);
  assert.equal(n.parts.clock, true); assert.equal(n.parts.rings, true); assert.equal(n.readings.gpu, false); assert.equal(n.readings.cpu, true);
  assert.equal(normalizeClosed({ quotaAlerts: "yes" }).quotaAlerts, true);
});
test("default values", () => {
  assert.deepEqual(CLOSED_DEFAULTS.order, [...PART_IDS]);
  assert.deepEqual(CLOSED_DEFAULTS.parts, { timer: true, discord: true, rings: true, title: false, readings: false, equalizer: true, clock: false, github: false, calendar: false, script: false, downloads: true, weather: false });
  assert.deepEqual(CLOSED_DEFAULTS.readings, { cpu: true, ram: true, gpu: true, net: false, power: false, battery: false, temp: false });
  assert.equal(CLOSED_DEFAULTS.clockSeconds, false); assert.equal(CLOSED_DEFAULTS.lineProgress, true); assert.equal(CLOSED_DEFAULTS.quotaAlerts, true); assert.equal(CLOSED_DEFAULTS.downloadAlerts, true);
  assert.equal(CLOSED_DEFAULTS.clockDate, false);
});
test("total on any shape", () => {
  for (const bad of [null, 0, "x", [], true, { order: "timer", parts: 3, readings: null }, { order: [1, null, {}] }]) assert.deepEqual(normalizeClosed(bad), CLOSED_DEFAULTS);
  assert.deepEqual(normalizeClosed({ order: ["rings", "rings", "timer", "rings"] }).order, ["rings", "timer", "discord", "title", "readings", "equalizer", "clock", "github", "calendar", "script", "downloads", "weather"]);
});
test("keeps valid saved values", () => {
  const saved = { order: ["clock", "title", "readings", "equalizer", "rings", "discord", "timer"], parts: { timer: false, title: true, clock: true }, readings: { cpu: false, ram: false, gpu: true }, clockSeconds: true, lineProgress: false, quotaAlerts: false };
  const n = normalizeClosed(saved);
  assert.deepEqual(n.order, [...saved.order, "github", "calendar", "script", "downloads", "weather"]);
  assert.equal(n.parts.timer, false); assert.equal(n.parts.title, true); assert.equal(n.parts.rings, true); assert.equal(n.parts.readings, false);
  assert.deepEqual(n.readings, { cpu: false, ram: false, gpu: true, net: false, power: false, battery: false, temp: false });
  assert.equal(normalizeClosed({ readings: { net: true, temp: "x" } }).readings.net, true);
  assert.equal(normalizeClosed({ readings: { net: true, temp: "x" } }).readings.temp, false);
  assert.equal(n.clockSeconds, true); assert.equal(n.lineProgress, false); assert.equal(n.quotaAlerts, false);
  // The date beside the clock (issue #41): off unless it was saved on.
  assert.equal(n.clockDate, false); assert.equal(normalizeClosed({ clockDate: true }).clockDate, true); assert.equal(normalizeClosed({ clockDate: 1 }).clockDate, false);
  assert.equal(normalizeClosed({ parts: { clock: "yes", rings: 0 } }).parts.clock, false); assert.equal(normalizeClosed({ parts: { rings: 0 } }).parts.rings, true);
});
test("does not alias the defaults", () => {
  const n = normalizeClosed(undefined);
  n.order.reverse(); n.parts.timer = false; n.readings.cpu = false;
  assert.deepEqual(CLOSED_DEFAULTS.order, [...PART_IDS]); assert.equal(CLOSED_DEFAULTS.parts.timer, true); assert.equal(CLOSED_DEFAULTS.readings.cpu, true);
});
test("status alerts setting", () => {
  const alerts = { power: true, net: true, bt: true, volume: true, brightness: true, lock: true, insert: false, hideOsd: false, mic: true };
  assert.deepEqual(normalizeClosed(undefined).statusAlerts, alerts);
  // 0.2 saved only the first three: the new ones take their defaults.
  assert.deepEqual(normalizeClosed({ statusAlerts: { net: false, power: true, bt: true } }).statusAlerts, { ...alerts, net: false });
  assert.deepEqual(normalizeClosed({ statusAlerts: { hideOsd: true, volume: "yes" } }).statusAlerts, { ...alerts, hideOsd: true });
  assert.deepEqual(normalizeClosed({ statusAlerts: "no" }).statusAlerts, alerts);
});
test("caption", () => {
  assert.equal(trackCaption("Paper Sky", "Lumen Coast"), "Paper Sky · Lumen Coast");
  assert.equal(trackCaption("Paper Sky", ""), "Paper Sky");
  assert.equal(trackCaption("", "Lumen Coast"), "Lumen Coast");
  assert.equal(trackCaption(" ", " "), "");
  assert.equal(trackCaption("  Paper Sky ", " Lumen Coast  "), "Paper Sky · Lumen Coast");
});

test("each part of the closed row opens its tool", () => {
  for (const [part, tool] of [["cover", "media"], ["title", "media"], ["lyric", "media"], ["equalizer", "media"], ["timer", "timer"], ["clock", "timer"], ["rings", "usage"], ["readings", "system"], ["discord", "discord"], ["github", "github"], ["calendar", "calendar"], ["script", "notices"], ["awake", "overview"], ["downloads", "shelf"], ["weather", "weather"]] as const)
    assert.equal(partTool(part), tool, part);
  // The privacy dots have no tool of their own; every part id has an answer.
  assert.equal(partTool("privacy"), null);
  for (const id of PART_IDS) assert.notEqual(partTool(id), null, id);
});

test("pet settings: unknown pets are none, the size stays in range, the side is left or right", () => {
  assert.deepEqual(normalizePet(undefined), { id: null, size: 48, side: "right" });
  assert.deepEqual(normalizePet({ id: "samurai", size: 500, side: "left" }), { id: "samurai", size: 96, side: "left" });
  assert.deepEqual(normalizePet({ id: "dragon", size: -3, side: "up" }), { id: null, size: 32, side: "right" });
  // The first pets were a string in 0.5 previews.
  assert.deepEqual(normalizePet("cat"), { id: null, size: 48, side: "right" });
});
