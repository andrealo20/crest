import { test } from "node:test";
import assert from "node:assert/strict";
import { BLACK, WHITE, contrast, type Rgba } from "../themes/color.ts";
import {
  HISTORY_MAX,
  formatHex,
  formatHsl,
  formatOklch,
  formatRgb,
  formatVar,
  fromOklch,
  harmonies,
  levels,
  normaliseColourState,
  parseColour,
  ratioShown,
  readableVersion,
  remember,
  toOklch,
} from "./colour.ts";

const c = (s: string) => parseColour(s)!;
const near = (actual: number, expected: number, tolerance: number, what: string) => assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} is not within ${tolerance} of ${expected}`);
const sound = (x: Rgba) => [x.r, x.g, x.b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255) && x.a >= 0 && x.a <= 1;

test("hex in 3, 4, 6 and 8 digits, with or without the #", () => {
  assert.deepEqual(c("#fff"), WHITE);
  assert.deepEqual(c("FFF"), WHITE);
  assert.deepEqual(c(" #0A84FF "), { r: 10, g: 132, b: 255, a: 1 });
  assert.deepEqual(c("#f00f"), { r: 255, g: 0, b: 0, a: 1 });
  assert.equal(c("#ff000080").a, 128 / 255);
  assert.equal(c("#f008").a, 0x88 / 255);
  assert.deepEqual(c("1a2b3c"), { r: 26, g: 43, b: 60, a: 1 });
});

test("rgb(), hsl() and the CSS names", () => {
  assert.deepEqual(c("rgb(255, 0, 0)"), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(c("rgb(1 2 3 / 50%)"), { r: 1, g: 2, b: 3, a: 0.5 });
  assert.deepEqual(c("RGBA(0,0,0,.25)"), { r: 0, g: 0, b: 0, a: 0.25 });
  assert.deepEqual(c("rgb(100% 0% 50%)"), { r: 255, g: 0, b: 128, a: 1 });
  assert.equal(formatHex(c("hsl(210 100% 60%)")), "#3399ff");
  assert.equal(formatHex(c("hsl(210, 100%, 60%)")), "#3399ff");
  assert.equal(formatHex(c("hsl(0.5turn 100% 50%)")), "#00ffff");
  assert.equal(formatHex(c("hsl(0 100% 50% / 0.5)")), "#ff000080");
  assert.equal(formatHex(c("Red")), "#ff0000");
  assert.equal(formatHex(c("grey")), "#808080");
  assert.equal(formatHex(c("  tomato ")), "#ff6347");
  assert.equal(c("transparent").a, 0);
});

test("oklch() with numbers, percentages and units", () => {
  assert.deepEqual(c("oklch(1 0 0)"), WHITE);
  assert.deepEqual(c("oklch(0 0 0)"), BLACK);
  for (const red of ["oklch(0.628 0.2577 29.23)", "oklch(62.8% 0.2577 29.23deg)", "oklch(0.628 64.4% 29.23 / 1)"]) {
    const x = c(red);
    near(x.r, 255, 2, red);
    near(x.g, 0, 2, red);
    near(x.b, 0, 3, red);
  }
  assert.equal(c("oklch(0.5 0.1 90 / 40%)").a, 0.4);
});

test("input that is not a colour", () => {
  for (const bad of ["", "   ", "#", "#12", "#12345", "#1234567", "#ggg", "nope", "constructor", "__proto__", "rgb(1, 2)", "rgb(1 2 3 4 5)", "rgb(a b c)", "rgb(1,,3)", "rgb(1 2 3", "rgb(1 2 3) x", "hsl(1 2)", "hsl(red 50% 50%)", "oklch(0.5 0.1)", "oklch(0.5 0.1 90xyz)", "oklch(NaN 1 1)", "rgb(1 2 3 / x)", "color(srgb 1 0 0)", "x".repeat(200)])
    assert.equal(parseColour(bad), null, JSON.stringify(bad));
});

test("outside the gamut is pulled in, never NaN", () => {
  for (const text of ["rgb(300 -5 0)", "rgb(1e3 0 0)", "hsl(400 200% 150%)", "hsl(-90 50% 50%)", "oklch(0.7 0.4 150)", "oklch(2 5 400)", "oklch(-1 -1 -1)", "oklch(0.9 100% 270)", "oklch(0.05 0.3 10)", "oklch(1 0.3 120)", "rgb(1 2 3 / 7)"]) {
    const x = parseColour(text);
    assert.ok(x && sound(x), text);
  }
  assert.deepEqual(c("rgb(300 -5 0)"), { r: 255, g: 0, b: 0, a: 1 });
  // Lightness and hue are kept, chroma is what gives: a very light colour stays light.
  assert.ok(toOklch(c("oklch(0.95 0.4 150)")).l > 0.9);
  for (const bad of [{ l: NaN, c: NaN, h: NaN }, { l: Infinity, c: Infinity, h: Infinity }, { l: -5, c: -5, h: -Infinity }]) assert.ok(sound(fromOklch(bad)), JSON.stringify(bad));
});

test("OKLCH against known values", () => {
  const white = toOklch(WHITE);
  near(white.l, 1, 1e-4, "white L");
  near(white.c, 0, 1e-4, "white C");
  assert.deepEqual(toOklch(BLACK), { l: 0, c: 0, h: 0 });
  for (const [hex, l, ch, h] of [["#ff0000", 0.628, 0.2577, 29.23], ["#00ff00", 0.8664, 0.2948, 142.5], ["#0000ff", 0.452, 0.3132, 264.05]] as const) {
    const x = toOklch(c(hex));
    near(x.l, l, 1e-3, `${hex} L`);
    near(x.c, ch, 1e-3, `${hex} C`);
    near(x.h, h, 0.1, `${hex} H`);
  }
  // A grey has no hue, whatever rounding left in a and b.
  assert.equal(toOklch(c("#777")).h, 0);
});

test("sRGB to OKLCH and back gives the same colour", () => {
  for (const hex of ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#777777", "#1a2b3c", "#0a84ff", "#ffd60a", "#30d158", "#ff453a", "#123456", "#fedcba"]) {
    assert.equal(formatHex(fromOklch(toOklch(c(hex)))), hex);
  }
});

test("the written forms", () => {
  const x = c("#1a2b3c");
  assert.equal(formatHex(x), "#1a2b3c");
  assert.equal(formatRgb(x), "rgb(26, 43, 60)");
  assert.equal(formatHsl(c("#3399ff")), "hsl(210, 100%, 60%)");
  assert.equal(formatOklch(WHITE), "oklch(1 0 0)");
  assert.equal(formatOklch(BLACK), "oklch(0 0 0)");
  assert.equal(formatOklch(c("#ff0000")), "oklch(0.628 0.258 29.2)");
  assert.equal(formatVar(x), "--colour: #1a2b3c;");
  const glass = c("#ff000080");
  assert.equal(formatHex(glass), "#ff000080");
  assert.equal(formatRgb(glass), "rgba(255, 0, 0, 0.5)");
  assert.equal(formatHsl(glass), "hsla(0, 100%, 50%, 0.5)");
  assert.match(formatOklch(glass), /^oklch\([\d. ]+ \/ 0\.5\)$/);
  // What is written reads back as the same colour (HSL and OKLCH are rounded for people, so only some colours come back exactly).
  for (const hex of ["#1a2b3c", "#3399ff", "#ffd60a80", "#000000"]) for (const write of [formatHex, formatRgb]) assert.equal(formatHex(c(write(c(hex)))), hex, `${write.name} ${hex}`);
  for (const hex of ["#3399ff", "#ff000080", "#ffffff"]) assert.equal(formatHex(c(formatHsl(c(hex)))), hex, `hsl ${hex}`);
  assert.equal(formatHex(c(formatOklch(c("#0a84ff")))), "#0a84ff");
});

test("WCAG contrast against known ratios", () => {
  assert.equal(ratioShown(contrast(WHITE, BLACK)), 21);
  assert.equal(contrast(c("#777"), c("#777")), 1);
  assert.equal(ratioShown(contrast(c("#777777"), WHITE)), 4.48);
  assert.equal(ratioShown(contrast(c("#767676"), WHITE)), 4.54);
  assert.equal(ratioShown(contrast(c("#0000ff"), BLACK)), 2.44);
  assert.equal(ratioShown(contrast(c("#ff0000"), WHITE)), 4);
});

test("levels and the shown ratio never claim a pass that is not one", () => {
  assert.deepEqual(levels(2.99), { aaLarge: false, aa: false, aaa: false });
  assert.deepEqual(levels(3), { aaLarge: true, aa: false, aaa: false });
  assert.deepEqual(levels(4.5), { aaLarge: true, aa: true, aaa: false });
  assert.deepEqual(levels(7), { aaLarge: true, aa: true, aaa: true });
  assert.deepEqual(levels(21), { aaLarge: true, aa: true, aaa: true });
  assert.equal(ratioShown(4.496), 4.49);
  assert.equal(ratioShown(2.9999), 2.99);
  assert.equal(ratioShown(6.999), 6.99);
  assert.equal(ratioShown(4.5), 4.5);
  assert.equal(ratioShown(4.478), 4.48);
  assert.equal(ratioShown(1), 1);
});

test("the readable version: darker on white, lighter on black, nothing when it already passes", () => {
  const onWhite = readableVersion(c("#777777"), WHITE)!;
  assert.equal(onWhite.lighter, false);
  assert.ok(onWhite.ratio >= 4.5 && onWhite.ratio < 4.7, String(onWhite.ratio));
  assert.equal(onWhite.ratio, contrast(onWhite.colour, WHITE));
  assert.ok(sound(onWhite.colour));
  const onBlack = readableVersion(c("#0000ff"), BLACK)!;
  assert.equal(onBlack.lighter, true);
  assert.ok(onBlack.ratio >= 4.5);
  assert.equal(readableVersion(c("#777777"), BLACK), null);
  assert.equal(readableVersion(c("#000000"), WHITE), null);
  // The hue stays: a blue made readable on white is still blue.
  const blue = readableVersion(c("#6699ff"), WHITE)!.colour;
  assert.ok(blue.b > blue.r && blue.b > blue.g);
  // Any background, even one where white and black are both just reachable.
  for (const bg of ["#808080", "#777777", "#bcbcbc", "#ff0000", "#00ff00", "#ffd60a"]) {
    const fix = readableVersion(c("#8a8a8a"), c(bg));
    if (fix) assert.ok(fix.ratio >= 4.5 && sound(fix.colour), bg);
  }
});

test("harmonies turn the hue", () => {
  const [complementary, triad, analogous] = harmonies(c("#ff0000"));
  assert.deepEqual(complementary.colours.map(formatHex), ["#ff0000", "#00ffff"]);
  assert.deepEqual(triad.colours.map(formatHex), ["#ff0000", "#00ff00", "#0000ff"]);
  assert.deepEqual(analogous.colours.map(formatHex), ["#ff0080", "#ff0000", "#ff8000"]);
  assert.deepEqual(harmonies(c("#808080"))[0].colours.map(formatHex), ["#808080", "#808080"]);
  assert.equal(formatHex(harmonies(c("#ff000080"))[0].colours[1]), "#00ffff80");
  for (const colour of ["#000000", "#ffffff", "#1a2b3c", "#ffd60a"]) for (const h of harmonies(c(colour))) assert.ok(h.colours.every(sound), colour);
});

test("history keeps the newest first, once each, at most 12", () => {
  assert.deepEqual(remember([], "#111111"), ["#111111"]);
  assert.deepEqual(remember(["#111111", "#222222", "#333333"], "#222222"), ["#222222", "#111111", "#333333"]);
  const many = Array.from({ length: 30 }, (_, i) => `#${String(i).padStart(2, "0")}0000`);
  let history: string[] = [];
  for (const hex of many) history = remember(history, hex);
  assert.equal(history.length, HISTORY_MAX);
  assert.equal(history[0], many[29]);
  assert.equal(history.at(-1), many[18]);
});

test("a saved state that is damaged still loads", () => {
  assert.deepEqual(normaliseColourState(undefined), { current: null, other: null, history: [] });
  assert.deepEqual(normaliseColourState("x"), { current: null, other: null, history: [] });
  assert.deepEqual(normaliseColourState({ current: "#ABC", other: "red", history: ["#aabbcc", "#AABBCC", 5, null, "nope", "#112233"] }), {
    current: "#aabbcc",
    other: "#ff0000",
    history: ["#aabbcc", "#112233"],
  });
  assert.equal(normaliseColourState({ history: Array.from({ length: 40 }, (_, i) => `#0000${i.toString(16).padStart(2, "0")}`) }).history.length, HISTORY_MAX);
  assert.deepEqual(normaliseColourState({ current: 5, other: {}, history: "x" }), { current: null, other: null, history: [] });
});
