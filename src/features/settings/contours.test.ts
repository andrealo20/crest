import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONTOUR_ALPHA, CONTOUR_FS, FIELDS, FRAME, IDLE, canvasSize, densityOf, fieldOf, loopRuns, nextDraw, tintsOf } from "./contours.ts";
import { parseTint } from "../../notch/glass/params.ts";
import { contrast, over, parseColor, withAlpha } from "../themes/color.ts";
import { resolveMaterial } from "../themes/material.ts";
import { BUILT_IN_THEMES, STRONG_TEXT, TERTIARY, TEXT } from "../themes/themes.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function pageIds(): string[] {
  const src = read("./SettingsView.tsx");
  const start = src.indexOf("const allPages");
  const block = src.slice(start, src.indexOf("];", start));
  return [...block.matchAll(/\{ id: "([\w-]+)", label:/g)].map((m) => m[1]);
}

const apart = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const inField = ([x, y, s]: readonly number[]) => x >= 0 && x <= 60 && y >= 0 && y <= 50 && s >= 2.1 && s <= 3.9;

test("every settings page and the search have a view of the field, far from the pages beside them", () => {
  const ids = pageIds();
  assert.ok(ids.length >= 14, `${ids.length} pages`);
  for (const id of [...ids, "search"]) assert.ok(id in FIELDS, id);
  for (const [id, view] of Object.entries(FIELDS)) assert.ok(inField(view), id);
  for (let i = 1; i < ids.length; i++) {
    const d = apart(fieldOf(ids[i - 1]), fieldOf(ids[i]));
    assert.ok(d >= 8, `${ids[i - 1]} then ${ids[i]}: ${d.toFixed(2)}`);
  }
  for (const id of ids) {
    const d = apart(fieldOf(id), fieldOf("search"));
    assert.ok(d >= 8, `${id} and search: ${d.toFixed(2)}`);
  }
  // A page added later (the bar's Widget page) falls back to the hash.
  assert.deepEqual(fieldOf("widgets"), fieldOf("widgets"));
  assert.ok(inField(fieldOf("widgets")), String(fieldOf("widgets")));
});

/** A fixed-seed linear congruential generator in [0, 1), so the jitter is the same on every run. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

/** Draws over frames at `hz` from `from` for `ms`, each frame up to `jitter` ms late. */
function draws(hz: number, ms: number, jitter: number, state = { last: -Infinity }, busy = false, from = 0, seed = 7): number {
  const rand = lcg(seed);
  let n = 0;
  for (let i = 0; ; i++) {
    const now = from + (i * 1000) / hz + rand() * jitter;
    if (now >= from + ms) break;
    const r = nextDraw(now, state.last, busy);
    state.last = r.last;
    if (r.draw) n++;
  }
  return n;
}

test("the field draws 30 times a second at rest at any refresh rate, and every frame while it moves", () => {
  for (const hz of [48, 60, 60.02, 75, 120, 144]) {
    for (const jitter of [0, 0.8]) {
      const n = draws(hz, 10_000, jitter);
      assert.ok(Math.abs(n - 300) <= 3, `${hz} Hz, ${jitter} ms jitter: ${n}`);
    }
  }
  const state = { last: -Infinity };
  const first = draws(60, 1000, 0, state);
  const second = draws(60, 1000, 0, state, false, 3000);
  assert.equal(first + second, 60, `${first} + ${second} after a 2 s pause`);
  assert.equal(draws(144, 1000, 0, { last: -Infinity }, true), 144);
  assert.equal(FRAME, 1000 / 30);
});

test("the canvas keeps Stellaria's 1.5 cap and at most 1.2 million pixels", () => {
  assert.equal(densityOf(2, 820, 600), 1.5);
  assert.equal(densityOf(1, 820, 600), 1);
  assert.deepEqual(canvasSize(2, 820, 600), { w: 1230, h: 900, k: 1.5 });
  const big = canvasSize(1.5, 2560, 1440);
  assert.ok(big.w * big.h <= 1.2e6, `${big.w} x ${big.h}`);
  const none = canvasSize(1, 0, 0);
  assert.ok(none.w >= 1 && none.h >= 1, `${none.w} x ${none.h}`);
});

test("the loop runs only with focus, visibility, motion, normal colours and input in the last minute", () => {
  const ok = { focused: true, visible: true, reduced: false, forced: false, now: 100_000, lastInput: 100_000 - 59_000 };
  assert.equal(loopRuns(ok), true);
  assert.equal(loopRuns({ ...ok, lastInput: ok.now - IDLE }), false);
  assert.equal(loopRuns({ ...ok, focused: false }), false);
  assert.equal(loopRuns({ ...ok, visible: false }), false);
  assert.equal(loopRuns({ ...ok, reduced: true }), false);
  assert.equal(loopRuns({ ...ok, forced: true }), false);
  assert.equal(IDLE, 60_000);
});

test("the lines take the theme's primary and tertiary, the primary twice without a tertiary, nothing without a colour", () => {
  const rgb = (text: string) => parseTint(text)!.slice(0, 3);
  const vars = { "--color-primary": "#a8c7fa" };
  assert.deepEqual(tintsOf({ vars, m3Tertiary: "#d6bee4" }), [rgb("#a8c7fa"), rgb("#d6bee4")]);
  assert.deepEqual(tintsOf({ vars }), [rgb("#a8c7fa"), rgb("#a8c7fa")]);
  assert.equal(tintsOf({ vars: { "--color-primary": "CanvasText" } }), null);
});

test("the shader is Stellaria's with an alpha uniform", () => {
  assert.ok(CONTOUR_FS.startsWith("#version 300 es"));
  for (const u of ["uRes", "uTime", "uOffset", "uScale", "uDpr", "uA", "uB", "uAlpha"]) assert.match(CONTOUR_FS, new RegExp(`uniform \\w+ ${u};`), u);
  assert.match(CONTOUR_FS, /float alpha = .*\* uAlpha;/);
  assert.ok(CONTOUR_FS.includes("fwidth(level)"));
});

test("text over the contour lines keeps its contrast on every theme", () => {
  const misses: string[] = [];
  for (const t of BUILT_IN_THEMES) {
    for (const level of [0, 1] as const) {
      const r = resolveMaterial(t, { contrast: level });
      const c = (name: string) => parseColor(r.vars[name])!;
      const notch = c("--color-notch");
      const texts: [string, number][] = [["--color-label", STRONG_TEXT], ["--color-label-2", TEXT], ["--color-label-3", TERTIARY]];
      const elevated = c("--color-elevated");
      for (const [name, minimum] of texts) {
        if (contrast(c(name), elevated) < minimum) misses.push(`${t.id} ${level} ${name} on elevated`);
      }
      for (const [line, color] of [["primary", c("--color-primary")], ["tertiary", parseColor(r.m3Tertiary)!]] as const) {
        const field = over(withAlpha(color, 0.62 * CONTOUR_ALPHA), notch);
        const grounds = { field, "fill-1": over(c("--color-fill-1"), field), "fill-2": over(c("--color-fill-2"), field) };
        for (const [ground, g] of Object.entries(grounds)) {
          for (const [name, minimum] of texts) {
            const ratio = contrast(c(name), g);
            if (ratio < minimum) misses.push(`${t.id} ${level} ${name} on ${ground} over the ${line} line: ${ratio.toFixed(2)}:1 < ${minimum}`);
          }
        }
      }
    }
  }
  assert.deepEqual(misses, []);
});

const count = (src: string, s: string) => src.split(s).length - 1;

test("the canvas asks for the glass's context, links through program() and draws in a loop of its own", () => {
  const src = read("./contours.ts");
  const ask = src.slice(src.indexOf('getContext("webgl2"'), src.indexOf("});", src.indexOf('getContext("webgl2"')));
  assert.ok(ask.length > 0, "getContext");
  for (const a of ['alpha: true', 'premultipliedAlpha: true', 'antialias: false', 'depth: false', 'stencil: false', 'preserveDrawingBuffer: false', 'powerPreference: "low-power"', 'failIfMajorPerformanceCaveat: true']) {
    assert.ok(ask.includes(a), a);
  }
  assert.ok(src.includes("program(gl, CONTOUR_FS)"));
  for (const s of ["requestAnimationFrame(", "nextDraw(", "loopRuns("]) assert.ok(src.includes(s), s);
  // An exception inside Motion's frame loop would stop every animation of the window.
  for (const s of ["frame.render", "frame.update"]) assert.ok(!src.includes(s), s);
  assert.match(src, /try \{[^}]*draw\(\);[^}]*\} catch \{[^}]*onFail\(true\)/);
  assert.equal(count(src, "onFail(false)"), 2);
  assert.ok(src.indexOf("onFail(false)") > src.indexOf("program("), "onFail(false) after the first link");
  const restored = src.slice(src.indexOf("const onRestored"), src.indexOf("\n  };", src.indexOf("const onRestored")));
  assert.ok(restored.includes("onFail(false)"), "onFail(false) on webglcontextrestored");
  assert.match(src, /Math\.min\([^)]*2 \* FRAME\)/);
});

test("the canvas survives a lost context, closes its own only once detached, and removes everything it listens to", () => {
  const src = read("./contours.ts");
  assert.ok(src.includes('"webglcontextlost"') && src.includes("preventDefault()"));
  assert.ok(src.includes('"webglcontextrestored"'));
  assert.equal(count(src, "loseContext()"), 1);
  assert.match(src, /setTimeout\(\(\) => \{\s*if \(!canvas\.isConnected\)[^\n]*loseContext\(\)/);
  for (const name of ["focus", "blur", "visibilitychange", "pointermove", "keydown", "wheel", "change", "webglcontextlost", "webglcontextrestored"]) {
    const on = count(src, `addEventListener("${name}"`), off = count(src, `removeEventListener("${name}"`);
    assert.ok(on >= 1 && on === off, `${name}: ${on} added, ${off} removed`);
  }
  assert.ok(src.includes("new ResizeObserver(") && src.includes("disconnect()"));
  assert.ok(src.includes("matchMedia(`(resolution: ${"));
  assert.ok(src.includes("matchMedia(`(-webkit-device-pixel-ratio: ${"));
  assert.ok(src.includes("springs.drift") && src.includes("themeFade"));
  assert.equal(count(src, 'console.debug("contours"'), 1);
  assert.match(src, /if \(import\.meta\.env\.DEV\) \{[^}]*console\.debug\("contours"/);
});

test("the contour component is a hidden canvas that fades in, follows the theme and forced colours, and stops on unmount", () => {
  const src = read("./Contours.tsx");
  for (const s of ["aria-hidden", 'className="pointer-events-none absolute inset-0 -z-10 size-full forced-colors:hidden"', "transition={crossfade}", "activeTheme.subscribe", "forcedColors.subscribe"]) {
    assert.ok(src.includes(s), s);
  }
  const cleanup = src.slice(src.indexOf("return () =>", src.indexOf("useLayoutEffect(")));
  assert.match(cleanup, /^return \(\) => \{[^}]*\.stop\(\)/);
});

test("the contour files keep the style's CSS rules and credit Stellaria and Hoskins", () => {
  for (const file of ["./contours.ts", "./Contours.tsx"]) {
    const src = read(file);
    for (const s of ["blur(", "color-mix(", "linear(", ":dir("]) assert.ok(!src.includes(s), `${file}: ${s}`);
    assert.doesNotMatch(src, /\b(bg|text|fill|stroke|ring|border)-[\w-]+\/\d/, file);
  }
  const head = read("./contours.ts").split("\n").slice(0, 8).join("\n");
  for (const s of ["Adapted from Stellaria (GPL-3.0", "dcc2f10", "Hash without Sine", "Modified for Crest, 2026-11-21"]) assert.ok(head.includes(s), s);
  const readme = read("../../../README.md").replace(/\s+/g, " ");
  assert.ok(readme.includes("the contour background and the navigation mark of the settings window and the load shapes of the Hardware tool are adapted from Stellaria's code"));
});
