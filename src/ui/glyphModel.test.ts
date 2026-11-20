import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BATTERY_BOLT,
  BATTERY_CAP,
  BATTERY_DASH,
  BODY_BOLT,
  DIM,
  FAN_APEX_Y,
  FAN_ARCS,
  FAN_RADII,
  FAN_WEDGE,
  GLOBE,
  MONITOR,
  MUTE,
  LEAF,
  PLANE,
  RUNE,
  SLASH,
  SPEAKER,
  WAVES,
  batteryDigits,
  batteryScale,
  batteryTint,
  batteryWideFill,
  batteryWidth,
  capsule,
  poly,
  speakerWaves,
  strip,
  wifiLit,
} from "./glyphModel.ts";

/** The straight edges of a path: where each horizontal (y) or vertical (x) segment's ink starts, a stroke's half its width off the path. */
function edges(d: string, stroke: number): { axis: "x" | "y"; at: number }[] {
  const out: { axis: "x" | "y"; at: number }[] = [];
  const t = d.match(/[MLHVAZ]|-?[\d.]+/g) ?? [];
  let x = 0, y = 0, sx = 0, sy = 0, cmd = "", i = 0;
  const num = () => +t[i++];
  while (i < t.length) {
    if (/[A-Z]/.test(t[i])) cmd = t[i++];
    let nx = x, ny = y;
    if (cmd === "M") [nx, ny] = [sx, sy] = [num(), num()];
    else if (cmd === "L") [nx, ny] = [num(), num()];
    else if (cmd === "H") nx = num();
    else if (cmd === "V") ny = num();
    else if (cmd === "A") (i += 5), ([nx, ny] = [num(), num()]);
    else if (cmd === "Z") [nx, ny] = [sx, sy];
    if ((cmd === "L" || cmd === "H" || cmd === "V" || cmd === "Z") && Math.hypot(nx - x, ny - y) > 0.01) {
      if (Math.abs(nx - x) < 1e-6) out.push({ axis: "x", at: x - stroke / 2 });
      if (Math.abs(ny - y) < 1e-6) out.push({ axis: "y", at: y - stroke / 2 });
    }
    [x, y] = [nx, ny];
  }
  return out;
}

test("the fan lights its wedge and one arc per signal step, nothing while unlinked or off", () => {
  assert.deepEqual(wifiLit("wifi-3"), { wedge: true, arcs: 3 });
  assert.deepEqual(wifiLit("wifi-2"), { wedge: true, arcs: 2 });
  assert.deepEqual(wifiLit("wifi-1"), { wedge: true, arcs: 1 });
  assert.deepEqual(wifiLit("wifi-0"), { wedge: true, arcs: 0 });
  assert.deepEqual(wifiLit("wifi-unlinked"), { wedge: false, arcs: 0 });
  assert.deepEqual(wifiLit("wifi-off"), { wedge: false, arcs: 0 });
});

test("each arc of the fan has its outer edge on a whole unit, where a 2 unit stroke stays sharp at 100 % and 200 %", () => {
  for (const r of FAN_RADII) assert.equal((FAN_APEX_Y - r - 1) % 1, 0);
});

test("the parts a level has not reached are dimmed to 0.4, one opacity for the set", () => {
  assert.equal(DIM, 0.4);
});

test("poly rounds every corner to 1, less where an edge is too short for it", () => {
  assert.equal(poly([[22, 5], [24, 5], [24, 11], [22, 11]]), "M22 6A1 1 0 0 1 23 5L23 5A1 1 0 0 1 24 6L24 10A1 1 0 0 1 23 11L23 11A1 1 0 0 1 22 10Z");
});

test("the leaf's stalk is a stadium of radius 1 round its segment", () => {
  assert.equal(capsule(1.5, 14.5, 4, 12), "M0.793 13.793L3.293 11.293A1 1 0 0 1 4.707 12.707L2.207 15.207A1 1 0 0 1 0.793 13.793Z");
});

test("every straight edge of the solid glyphs lies on a whole unit", () => {
  const shapes: [string, string, number][] = [
    ["FAN_WEDGE", FAN_WEDGE, 0],
    ...FAN_ARCS.map((d, i): [string, string, number] => [`FAN_ARCS[${i}]`, d, 2]),
    ["SLASH", SLASH, 2],
    ["MONITOR", MONITOR, 0],
    ["GLOBE", GLOBE, 0],
    ["SPEAKER", SPEAKER, 0],
    ...WAVES.map((d, i): [string, string, number] => [`WAVES[${i}]`, d, 2]),
    ["MUTE", MUTE, 2],
    ["RUNE", RUNE, 2],
    ["PLANE", PLANE, 0],
    ["LEAF", LEAF, 0],
    ["BATTERY_CAP", BATTERY_CAP, 0],
    ["BATTERY_BOLT", BATTERY_BOLT, 0],
    ["BODY_BOLT", BODY_BOLT, 0],
    ["BATTERY_DASH", BATTERY_DASH, 0],
  ];
  let seen = 0;
  for (const [name, d, stroke] of shapes)
    for (const e of edges(d, stroke)) {
      seen++;
      assert.ok(Math.abs(e.at - Math.round(e.at)) < 1e-6, `${name}: ${e.axis === "x" ? "vertical" : "horizontal"} edge at ${e.axis} ${e.at}`);
    }
  assert.ok(seen >= 28, `only ${seen} straight edges read`);
});

test("the speaker draws a wave per volume step and none when muted", () => {
  assert.equal(speakerWaves("muted"), 0);
  assert.equal(speakerWaves("low"), 1);
  assert.equal(speakerWaves("mid"), 2);
  assert.equal(speakerWaves("high"), 3);
});

test("the battery's number shows from 14 device px, half units from 32, and its cut is one device pixel, never under 0.5", () => {
  assert.equal(batteryScale(13.75).number, false);
  assert.equal(batteryScale(14).number, true);
  assert.equal(batteryScale(31).half, false);
  assert.equal(batteryScale(32).half, true);
  assert.equal(batteryScale(16).cut, 1);
  assert.equal(batteryScale(20).cut, 0.8);
  assert.equal(batteryScale(32).cut, 0.5);
  assert.equal(batteryScale(64).cut, 0.5);
  assert.equal(batteryScale(16).baseline, 11);
  assert.equal(batteryScale(32).baseline, 11.5);
});

test("the battery is full only at 100, in whole units under 32 device px and half units from 32, never under 2 while charge is left", () => {
  assert.equal(batteryWideFill(100, 16), 20);
  assert.equal(batteryWideFill(99, 16), 19);
  assert.equal(batteryWideFill(99, 32), 19.5);
  assert.equal(batteryWideFill(63, 16), 13);
  assert.equal(batteryWideFill(63, 32), 12.5);
  assert.equal(batteryWideFill(60, 16), 12);
  assert.equal(batteryWideFill(37, 32), 7.5);
  assert.equal(batteryWideFill(1, 16), 2);
  assert.equal(batteryWideFill(0, 16), 0);
  assert.equal(batteryWideFill(null, 16), null);
  assert.equal(batteryWideFill(99.6, 16), 20);
  for (const [px, step] of [[16, 1], [32, 0.5]]) {
    let prev = 0;
    for (let p = 0; p <= 100; p++) {
      const w = batteryWideFill(p, px) as number;
      assert.ok(w >= prev, `${p} % at ${px} px: ${w} under ${prev}`);
      assert.equal(w % step, 0, `${p} % at ${px} px: ${w} off the step`);
      if (p < 100) assert.ok(w <= 20 - step, `${p} % at ${px} px: ${w} reads full`);
      if (p > 0) assert.ok(w >= 2, `${p} % at ${px} px: ${w} under 2`);
      prev = w;
    }
  }
});

test("each digit sits in its tabular cell round x 11 and takes one ink by its cell's middle", () => {
  assert.deepEqual(batteryDigits(63, 13, false), [{ d: "6", x: 7.89, inked: false }, { d: "3", x: 14.11, inked: true }]);
  assert.deepEqual(batteryDigits(100, 20, false).map((g) => g.x), [4.779, 11, 17.221]);
  assert.equal(batteryDigits(100, 20, false).some((g) => g.inked), false);
  assert.deepEqual(batteryDigits(5, 2, true), [{ d: "5", x: 11, inked: true }]);
  assert.ok(batteryDigits(63, 13, true).every((g) => g.inked));
  assert.equal(batteryDigits(100, 20, true).some((g) => g.inked), false);
  assert.equal(batteryDigits(62.6, 13, false).map((g) => g.d).join(""), "63");
});

test("a warning reds the battery and wins over Energy saver", () => {
  assert.equal(batteryTint(true, true), "red");
  assert.equal(batteryTint(false, true), "green");
  assert.equal(batteryTint(false, false), null);
});

test("the battery is 27/16 of the glyph, rounded up to a whole px", () => {
  assert.equal(batteryWidth(16), 27);
  assert.equal(batteryWidth(13), 22);
  assert.equal(batteryWidth(11), 19);
  assert.equal(batteryWidth(27), 46);
});

test("the battery's body is cut at its level's edge, its corners rounded", () => {
  assert.equal(strip(1, 2, 21, 14, 1, 14), "M1 3A1 1 0 0 1 2 2H14V14H2A1 1 0 0 1 1 13Z");
});

test("the battery's level lies on a whole device pixel at 16 px on 100 % and 200 %", () => {
  for (const [px, unit] of [[16, 1], [32, 0.5]])
    for (let p = 0; p <= 100; p++) {
      const w = batteryWideFill(p, px) as number;
      if (w === 0 || w === 20) continue;
      for (const d of [strip(1, 2, 21, 14, 1, 1 + w), strip(1, 2, 21, 14, 1 + w, 21)])
        for (const e of edges(d, 0)) assert.equal(e.at % unit, 0, `${p} % at ${px} px: ${e.axis} edge at ${e.at}`);
    }
});
