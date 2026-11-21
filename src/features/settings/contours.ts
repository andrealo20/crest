// Adapted from Stellaria (GPL-3.0, github.com/SMIDR76/stellaria-windows), launcher/ui/launcher.js at dcc2f10: the contour
// shader (three octaves of fBm, 30 levels, lines from fwidth), its 1.5 cap on the pixel ratio and the first eight page views
// (topoFields). Stellaria ports Caelestia (GPL-3.0, github.com/caelestia-dots/shell).
// Modified for Crest, 2026-11-21: an alpha uniform, a 1.2 million pixel cap, a 30 fps loop at rest that stops without focus,
// input or visibility, page views from a table with a hash for new pages, Crest's springs for the drift and the theme's fade.
// hash3 starts from David Hoskins's integer hash33 of "Hash without Sine" (shadertoy.com/view/4djSRW), MIT License.

import { idHash } from "../system/hero.ts";
import { parseTint } from "../../notch/glass/params.ts";
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
  "taskbar-apps": [31, 4, 2.2],
  "taskbar-look": [44, 36, 3.0],
  search: [2, 48, 2.5],
};

/** A page's view of the field: from the table, else from its id, offset 0..60 by 0..50 and scale 2.1..3.9 like the table. */
export function fieldOf(id: string): [x: number, y: number, scale: number] {
  const known = FIELDS[id];
  if (known) return [...known];
  const h = idHash(id);
  return [(h % 6000) / 100, ((h >>> 8) % 5000) / 100, 2.1 + ((h >>> 16) % 19) / 10];
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
