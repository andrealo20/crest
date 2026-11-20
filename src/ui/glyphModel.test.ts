import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIM,
  FAN_APEX_Y,
  FAN_ARCS,
  FAN_RADII,
  FAN_WEDGE,
  GLOBE,
  MONITOR,
  MUTE,
  RUNE,
  SLASH,
  SPEAKER,
  WAVES,
  batteryFill,
  poly,
  speakerWaves,
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
  ];
  let seen = 0;
  for (const [name, d, stroke] of shapes)
    for (const e of edges(d, stroke)) {
      seen++;
      assert.ok(Math.abs(e.at - Math.round(e.at)) < 1e-6, `${name}: ${e.axis === "x" ? "vertical" : "horizontal"} edge at ${e.axis} ${e.at}`);
    }
  assert.ok(seen >= 17, `only ${seen} straight edges read`);
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
