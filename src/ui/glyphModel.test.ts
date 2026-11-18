import { test } from "node:test";
import assert from "node:assert/strict";
import { FAN_APEX_Y, FAN_RADII, batteryFill, speakerWaves, wifiLit } from "./glyphModel.ts";

test("the fan lights its wedge and one arc per signal step, nothing while unlinked or off", () => {
  assert.deepEqual(wifiLit("wifi-3"), { wedge: true, arcs: 3 });
  assert.deepEqual(wifiLit("wifi-2"), { wedge: true, arcs: 2 });
  assert.deepEqual(wifiLit("wifi-1"), { wedge: true, arcs: 1 });
  assert.deepEqual(wifiLit("wifi-0"), { wedge: true, arcs: 0 });
  assert.deepEqual(wifiLit("wifi-unlinked"), { wedge: false, arcs: 0 });
  assert.deepEqual(wifiLit("wifi-off"), { wedge: false, arcs: 0 });
});

test("each arc of the fan has its top on a half pixel, where a 1 px stroke stays sharp", () => {
  for (const r of FAN_RADII) assert.equal((FAN_APEX_Y - r) % 1, 0.5);
});

test("the speaker draws a wave per volume step and none when muted", () => {
  assert.equal(speakerWaves("muted"), 0);
  assert.equal(speakerWaves("low"), 1);
  assert.equal(speakerWaves("mid"), 2);
  assert.equal(speakerWaves("high"), 3);
});

test("the battery fills as wide as its level in half pixels, never empty while charge is left", () => {
  assert.equal(batteryFill(100), 9);
  assert.equal(batteryFill(94), 8.5);
  assert.equal(batteryFill(50), 4.5);
  assert.equal(batteryFill(1), 0.5);
  assert.equal(batteryFill(0), 0);
  assert.equal(batteryFill(null), 9);
});
