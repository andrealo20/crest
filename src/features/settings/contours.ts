// Adapted from Stellaria (GPL-3.0, github.com/SMIDR76/stellaria-windows), launcher/ui/launcher.js at dcc2f10: the contour
// shader (its hash3 unchanged, three octaves of fBm, 30 levels, lines from fwidth), its 1.5 cap on the pixel ratio and the
// first eight page views (topoFields). Stellaria ports Caelestia (GPL-3.0, github.com/caelestia-dots/shell).
// Modified for Crest, 2026-11-21: an alpha uniform, a 1.2 million pixel cap, a 30 fps loop at rest that stops without focus,
// input or visibility, page views from a table with a hash for new pages, Crest's springs for the drift and the theme's fade.
//
// The first two lines of hash3 are David Hoskins's integer hash (constants 1597334673, 3812015801, 2798796415), credited to him in
// public copies of it. Its own Shadertoy page could not be read, so its licence is taken from his MIT hash collection, Hash without
// Sine (licenses/HashWithoutSine-MIT.txt):
//
// Copyright (c)2014 David Hoskins.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import { animate, motionValue, type AnimationPlaybackControls } from "motion";
import { springs, themeFade } from "../../design/motion.ts";
import { idHash } from "../system/hero.ts";
import { parseTint } from "../../notch/glass/params.ts";
import { program, type Program } from "../../notch/glass/shader.ts";
import type { ResolvedTheme } from "../themes/themes.ts";

export const CONTOUR_FS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uOffset;
uniform float uScale;
uniform float uDpr;
uniform vec3 uA;
uniform vec3 uB;
uniform float uAlpha;
out vec4 color;
vec3 hash3(vec3 p) {
  uvec3 q = uvec3(ivec3(p)) * uvec3(1597334673u, 3812015801u, 2798796415u);
  q = (q.x ^ q.y ^ q.z) * uvec3(1597334673u, 3812015801u, 2798796415u);
  q ^= q >> 16u;
  q *= uvec3(2246822519u, 3266489917u, 668265263u);
  return -1.0 + 2.0 * vec3(q >> 8u) / 16777215.0;
}
float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(dot(hash3(i), f), dot(hash3(i + vec3(1, 0, 0)), f - vec3(1, 0, 0)), u.x),
        mix(dot(hash3(i + vec3(0, 1, 0)), f - vec3(0, 1, 0)), dot(hash3(i + vec3(1, 1, 0)), f - vec3(1, 1, 0)), u.x), u.y),
    mix(mix(dot(hash3(i + vec3(0, 0, 1)), f - vec3(0, 0, 1)), dot(hash3(i + vec3(1, 0, 1)), f - vec3(1, 0, 1)), u.x),
        mix(dot(hash3(i + vec3(0, 1, 1)), f - vec3(0, 1, 1)), dot(hash3(i + vec3(1, 1, 1)), f - vec3(1, 1, 1)), u.x), u.y), u.z);
}
float fbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.62;
  for (int octave = 0; octave < 3; octave++) {
    value += amplitude * noise(p);
    p = p * 2.03 + vec3(17.0, 9.0, 3.0);
    amplitude *= 0.42;
  }
  return value;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes.y;
  float field = fbm(vec3(uv * uScale + uOffset, uTime)) * 0.5 + 0.5;
  float level = field * 30.0;
  float distance = abs(fract(level + 0.5) - 0.5) / max(fwidth(level), 1e-4);
  float width = (0.85 + 0.5 * field) * uDpr;
  float line = 1.0 - smoothstep(width - 0.75, width + 0.75, distance);
  vec3 tint = mix(uA, uB, smoothstep(0.35, 0.75, field));
  uint index = uint(int(floor(level + 0.5)) + 64) * 2654435761u;
  float shade = 0.45 + 0.55 * float((index ^ (index >> 15u)) & 1023u) / 1023.0;
  float alpha = line * shade * (0.22 + 0.4 * sin(clamp(field, 0.0, 1.0) * 3.14159)) * uAlpha;
  color = vec4(tint * alpha, alpha);
}`;

/** The highest strength, in steps of 0.05, that keeps every theme's text at its minimum over the lines (contours.test.ts);
 *  at 0.35 label on the search pill drops to 6.69:1 and label-3 to 2.72:1. */
export const CONTOUR_ALPHA = 0.3;

/** Each page's view of the field: offset and scale. The first eight are Stellaria's topoFields; a page missing here takes the hash. */
export const FIELDS: Record<string, readonly [x: number, y: number, scale: number]> = {
  general: [0, 0, 3.0],
  display: [13.7, 5.1, 2.4],
  window: [27.2, 19.4, 3.6],
  tools: [41.9, 8.3, 2.1],
  timer: [6.6, 33.8, 2.8],
  ai: [52.4, 27.5, 3.3],
  accounts: [19.1, 47.2, 2.6],
  themes: [35.5, 41.6, 3.9],
  notices: [58, 46, 2.3],
  plugins: [24, 30, 3.1],
  taskbar: [48, 14, 2.7],
  "taskbar-items": [10, 20, 3.5],
  "taskbar-widgets": [55, 2, 2.9],
  "taskbar-apps": [31, 4, 2.2],
  "taskbar-look": [44, 36, 3.0],
  search: [2, 48, 2.5],
};

/** A page's view of the field: from the table, else from its id, offset 0..60 by 0..50 and scale 2.1..3.9 like the table. */
export function fieldOf(id: string): [x: number, y: number, scale: number] {
  const known = FIELDS[id];
  if (known) return [...known];
  const h = idHash(id);
  return [(h % 6000) / 100, ((h >>> 8) % 5000) / 100, (21 + ((h >>> 16) % 19)) / 10];
}

export const FRAME = 1000 / 30;

/** Whether to draw at `now`, and the time the next interval counts from: every frame while `busy`, else 30 a second at any refresh rate. */
export function nextDraw(now: number, last: number, busy: boolean): { draw: boolean; last: number } {
  const gap = now - last;
  if (busy || gap > 2 * FRAME) return { draw: true, last: now };
  if (gap < FRAME - 1) return { draw: false, last };
  return { draw: true, last: last + FRAME };
}

/** Canvas pixels per CSS px: the screen's, at most 1.5 as in Stellaria, and at most 1.2 million pixels in all. */
export function densityOf(dpr: number, cssW: number, cssH: number): number {
  return Math.min(dpr, 1.5, Math.sqrt(1.2e6 / Math.max(1, cssW * cssH)));
}

/** The canvas's pixel size, rounded down so the pixel cap holds, and never 0 so the context keeps a drawing buffer. */
export function canvasSize(dpr: number, cssW: number, cssH: number): { w: number; h: number; k: number } {
  const k = densityOf(dpr, cssW, cssH);
  return { w: Math.max(1, Math.floor(cssW * k)), h: Math.max(1, Math.floor(cssH * k)), k };
}

export const IDLE = 60_000;

/** Whether the field moves on its own. The input rule is there because on Windows a focused window gets no blur when the
 *  screen turns off for inactivity without locking, and the loop would run for hours in front of a window left open. */
export function loopRuns(c: { focused: boolean; visible: boolean; reduced: boolean; forced: boolean; now: number; lastInput: number }): boolean {
  return c.focused && c.visible && !c.reduced && !c.forced && c.now - c.lastInput < IDLE;
}

export type Rgb = [number, number, number];

/** The lines' two colours, read from the theme in JavaScript because the CSS colours are mid-fade during a theme change;
 *  the primary twice when the theme has no Material tertiary, null when the primary is not a colour (forced colours). */
export function tintsOf(theme: Pick<ResolvedTheme, "vars" | "m3Tertiary">): [Rgb, Rgb] | null {
  const a = parseTint(theme.vars["--color-primary"]);
  const b = parseTint(theme.m3Tertiary ?? theme.vars["--color-primary"]);
  if (!a || !b) return null;
  return [[a[0], a[1], a[2]], [b[0], b[1], b[2]]];
}

export interface ContourOpts { page: string; tints: [Rgb, Rgb]; reduced: boolean; forced: boolean; onFail: (failed: boolean) => void }
export interface ContourHandle { page(id: string): void; tints(next: [Rgb, Rgb]): void; forced(on: boolean): void; stop(): void }

/** The program and the empty vertex array the full canvas triangle draws from; null when the program does not link. */
function setup(gl: WebGL2RenderingContext): { prog: Program; vao: WebGLVertexArrayObject } | null {
  const prog = program(gl, CONTOUR_FS);
  if (!prog) return null;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  return { prog, vao };
}

const mix = (from: Rgb, to: Rgb, p: number): Rgb => [from[0] + (to[0] - from[0]) * p, from[1] + (to[1] - from[1]) * p, from[2] + (to[2] - from[2]) * p];

/** Draws the contour field into `canvas` until `stop()`: 30 frames a second at rest, every frame while it drifts or fades. */
export function startContours(canvas: HTMLCanvasElement, opts: ContourOpts): ContourHandle {
  const { onFail, reduced } = opts;
  // Software rendering gives no context (failIfMajorPerformanceCaveat): the settings window shows its still light instead.
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: "low-power",
    failIfMajorPerformanceCaveat: true,
  });
  // StrictMode mounts the same canvas again at once, and a lost context cannot be had back from it. Left to the collector, old
  // contexts would keep their buffers, and notch, bars and settings share the renderer's 16 live contexts, past which the oldest
  // (a notch's or a bar's glass) is lost: closed on stop, only once the canvas is gone, also when the program did not link.
  const release = () => {
    window.setTimeout(() => {
      if (!canvas.isConnected) gl?.getExtension("WEBGL_lose_context")?.loseContext();
    }, 0);
  };
  let gpu = gl ? setup(gl) : null;
  if (!gl || !gpu) {
    onFail(true);
    return { page() {}, tints() {}, forced() {}, stop() { release(); } };
  }
  // The failed state lives in SettingsView and outlives a canvas: a new one that links clears it.
  onFail(false);

  let current = opts.page;
  const view = fieldOf(current);
  const x = motionValue(view[0]), y = motionValue(view[1]), scale = motionValue(view[2]);
  let [a, b] = opts.tints;
  let fade: AnimationPlaybackControls | null = null, fading = false;
  let time = 0, last = -Infinity, lastDrawn = performance.now(), lastInput = performance.now();
  let focused = document.hasFocus(), visible = document.visibilityState === "visible", forced = opts.forced;
  // dead: the context is lost, a draw threw or the canvas stopped. pending: one draw asked for, whatever the loop does.
  let raf = 0, dead = false, pending = true, wasBusy = false, draws = 0;
  let css = { w: canvas.clientWidth, h: canvas.clientHeight }, size = canvasSize(devicePixelRatio, css.w, css.h);

  const runs = (now: number) => loopRuns({ focused, visible, reduced, forced, now, lastInput });
  const busyNow = () => x.isAnimating() || y.isAnimating() || scale.isAnimating() || fading;

  const draw = () => {
    const { p, u } = gpu!.prog;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(p);
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    gl.uniform1f(u.uTime, time);
    gl.uniform2f(u.uOffset, x.get(), y.get());
    gl.uniform1f(u.uScale, scale.get());
    gl.uniform1f(u.uDpr, size.k);
    gl.uniform3f(u.uA, ...a);
    gl.uniform3f(u.uB, ...b);
    gl.uniform1f(u.uAlpha, CONTOUR_ALPHA);
    // No clear: the triangle covers every pixel.
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const tick = (now: number) => {
    raf = 0;
    if (dead) return;
    const running = runs(now), busy = busyNow();
    // The last step of a drift or a fade lands after the frame that saw it moving: one more draw where it settled.
    if (wasBusy && !busy) pending = true;
    wasBusy = busy;
    if (running || busy || pending) {
      const next = pending ? { draw: true, last: now } : nextDraw(now, last, busy);
      last = next.last;
      if (next.draw) {
        // Only the running loop moves the field, at most two frames' worth: back after minutes without focus, it goes on from where it was.
        if (running) time += (Math.min(now - lastDrawn, 2 * FRAME) / 1000) * 0.045;
        lastDrawn = now;
        pending = false;
        try {
          draw();
          draws++;
        } catch {
          dead = true;
          onFail(true);
          return;
        }
      }
    }
    if (running || busy) raf = requestAnimationFrame(tick);
  };
  const wake = () => {
    if (!raf && !dead && !forced) raf = requestAnimationFrame(tick);
  };

  // Back from Alt+Tab after more than a minute, lastInput is old: coming back is input too.
  const onFocus = () => {
    focused = true;
    lastInput = performance.now();
    wake();
  };
  const onBlur = () => {
    focused = false;
  };
  const onVisibility = () => {
    visible = document.visibilityState === "visible";
    wake();
  };
  const onInput = () => {
    lastInput = performance.now();
    wake();
  };
  // Setting width or height clears the drawing buffer, so a resize always draws again, with the loop stopped too.
  const resize = () => {
    size = canvasSize(devicePixelRatio, css.w, css.h);
    if (canvas.width !== size.w) canvas.width = size.w;
    if (canvas.height !== size.h) canvas.height = size.h;
    pending = true;
    wake();
  };
  const observer = new ResizeObserver(([entry]) => {
    css = { w: entry.contentRect.width, h: entry.contentRect.height };
    resize();
  });
  // A change of the screen's scale, which the observer does not see.
  let query: MediaQueryList | null = null;
  const onScale = () => {
    resize();
    watchScale();
  };
  const unwatchScale = () => query?.removeEventListener("change", onScale);
  const watchScale = () => {
    unwatchScale();
    // WebKit before 16 (macOS 12 with Safari 15) has no resolution in dppx and would never send change.
    const dppx = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    query = dppx.matches ? dppx : matchMedia(`(-webkit-device-pixel-ratio: ${devicePixelRatio})`);
    query.addEventListener("change", onScale);
  };
  const onLost = (e: Event) => {
    e.preventDefault();
    dead = true;
    cancelAnimationFrame(raf);
    raf = 0;
    onFail(true);
  };
  const onRestored = () => {
    gpu = setup(gl);
    if (!gpu) return;
    dead = false;
    onFail(false);
    pending = true;
    wake();
  };

  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pointermove", onInput, { passive: true });
  window.addEventListener("keydown", onInput, { passive: true });
  window.addEventListener("wheel", onInput, { passive: true });
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  observer.observe(canvas);
  watchScale();
  resize();

  let counter = 0;
  if (import.meta.env.DEV) {
    counter = window.setInterval(() => {
      console.debug("contours", draws / 5);
      draws = 0;
    }, 5000);
  }

  return {
    page(id) {
      if (id === current) return;
      current = id;
      const target = fieldOf(id);
      [x, y, scale].forEach((v, i) => {
        if (reduced) v.jump(target[i]);
        else animate(v, target[i], springs.drift);
      });
      if (reduced) pending = true;
      wake();
    },
    tints(next) {
      fade?.stop();
      if (reduced) {
        [a, b] = next;
        pending = true;
      } else {
        // From the colours drawn now, also halfway through the last fade.
        const from = [a, b];
        fading = true;
        fade = animate(0, 1, {
          ...themeFade,
          onUpdate: (p) => {
            a = mix(from[0], next[0], p);
            b = mix(from[1], next[1], p);
          },
          onComplete: () => {
            fading = false;
          },
        });
      }
      wake();
    },
    forced(on) {
      forced = on;
      if (on) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else wake();
    },
    stop() {
      dead = true;
      cancelAnimationFrame(raf);
      window.clearInterval(counter);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onInput);
      window.removeEventListener("keydown", onInput);
      window.removeEventListener("wheel", onInput);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      observer.disconnect();
      unwatchScale();
      x.stop();
      y.stop();
      scale.stop();
      fade?.stop();
      if (gpu) {
        gl.deleteProgram(gpu.prog.p);
        gl.deleteVertexArray(gpu.vao);
      }
      release();
    },
  };
}
