import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BATTERY_BOLT,
  BATTERY_FILL,
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
  WAVES,
  batteryFill,
  batteryShape,
  batteryTint,
  batteryWidth,
  capsule,
  poly,
  speakerBody,
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

test("the fan lights its wedge and an arc per step in three steps, the two weakest signals the wedge alone, nothing while unlinked or off", () => {
  assert.deepEqual(wifiLit("wifi-3"), { wedge: true, arcs: 2 });
  assert.deepEqual(wifiLit("wifi-2"), { wedge: true, arcs: 1 });
  assert.deepEqual(wifiLit("wifi-1"), { wedge: true, arcs: 0 });
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
    ["speaker body", speakerBody(16), 0],
    ...WAVES.map((d, i): [string, string, number] => [`WAVES[${i}]`, d, 2]),
    ["MUTE", MUTE, 2],
    ["RUNE", RUNE, 2],
    ["PLANE", PLANE, 0],
    ["LEAF", LEAF, 0],
    ["battery shell", batteryShape(16).shell, 0],
    ["battery cap", batteryShape(16).cap, 0],
    ["BATTERY_BOLT", BATTERY_BOLT, 0],
  ];
  let seen = 0;
  for (const [name, d, stroke] of shapes)
    for (const e of edges(d, stroke)) {
      seen++;
      assert.ok(Math.abs(e.at - Math.round(e.at)) < 1e-6, `${name}: ${e.axis === "x" ? "vertical" : "horizontal"} edge at ${e.axis} ${e.at}`);
    }
  assert.ok(seen >= 28, `only ${seen} straight edges read`);
});

test("from 32 device px the speaker's box is 5 tall on half units, sharp at 200 %", () => {
  const d = speakerBody(32);
  const ys = edges(d, 0).filter((e) => e.axis === "y").map((e) => e.at);
  assert.deepEqual(ys.sort((a, b) => a - b), [5.5, 10.5]);
  for (const e of edges(d, 0)) assert.equal(e.at % 0.5, 0);
});

test("the speaker draws a wave per volume step and none when muted", () => {
  assert.equal(speakerWaves("muted"), 0);
  assert.equal(speakerWaves("low"), 1);
  assert.equal(speakerWaves("mid"), 2);
  assert.equal(speakerWaves("high"), 3);
});

test("the battery is full only at 100, in whole units under 32 device px and half units from 32, never under 2 while charge is left", () => {
  assert.equal(batteryFill(100, 16), 18);
  assert.equal(batteryFill(99, 16), 17);
  assert.equal(batteryFill(99, 32), 17.5);
  assert.equal(batteryFill(63, 16), 11);
  assert.equal(batteryFill(63, 32), 11.5);
  assert.equal(batteryFill(50, 16), 9);
  assert.equal(batteryFill(1, 16), 2);
  assert.equal(batteryFill(0, 16), 0);
  assert.equal(batteryFill(null, 16), null);
  assert.equal(batteryFill(99.6, 16), 18);
  for (const [px, step] of [[16, 1], [32, 0.5]]) {
    let prev = 0;
    for (let p = 0; p <= 100; p++) {
      const w = batteryFill(p, px) as number;
      assert.ok(w >= prev, `${p} % at ${px} px: ${w} under ${prev}`);
      assert.equal(w % step, 0, `${p} % at ${px} px: ${w} off the step`);
      if (p < 100) assert.ok(w <= 18 - step, `${p} % at ${px} px: ${w} reads full`);
      if (p > 0) assert.ok(w >= 2, `${p} % at ${px} px: ${w} under 2`);
      prev = w;
    }
  }
});

test("as on an iPhone: a warning red, Energy saver yellow also while charging, else charging green", () => {
  assert.equal(batteryTint(true, true, true), "red");
  assert.equal(batteryTint(false, true, true), "yellow");
  assert.equal(batteryTint(false, true, false), "yellow");
  assert.equal(batteryTint(false, false, true), "green");
  assert.equal(batteryTint(false, false, false), null);
});

test("the battery is 26/16 of the glyph, rounded up to a whole px", () => {
  assert.equal(batteryWidth(16), 26);
  assert.equal(batteryWidth(13), 22);
  assert.equal(batteryWidth(11), 18);
  assert.equal(batteryWidth(17), 28);
});

test("from 32 device px the battery's outline and cap lie on half units, sharp at 200 %, with Apple's outline of 1.5 and gaps of 0.5", () => {
  const { shell, cap, cut } = batteryShape(32);
  for (const d of [shell, cap]) for (const e of edges(d, 0)) assert.equal(e.at % 0.5, 0, `${e.axis} edge at ${e.at}`);
  assert.ok(shell.includes("M4 3.5H20"), shell);
  assert.equal(cut, 1);
  assert.equal(batteryShape(31).cut, 2);
});

test("the battery's charge is cut at its level's edge, its corners rounded", () => {
  assert.equal(strip(3, 4, 21, 12, 3, 10), "M3 5A1 1 0 0 1 4 4H10V12H4A1 1 0 0 1 3 11Z");
});

test("the battery's level lies on a whole device pixel at 16 px on 100 % and 200 %", () => {
  const [x0, y0, x1, y1] = BATTERY_FILL;
  for (const [px, unit] of [[16, 1], [32, 0.5]])
    for (let p = 0; p <= 100; p++) {
      const w = batteryFill(p, px) as number;
      if (w === 0) continue;
      for (const e of edges(strip(x0, y0, x1, y1, x0, x0 + w), 0)) assert.equal(e.at % unit, 0, `${p} % at ${px} px: ${e.axis} edge at ${e.at}`);
    }
});
