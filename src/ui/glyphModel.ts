// The rules and shapes of Crest's glyphs, pure. glyphs.tsx draws them on a 16 grid as solid shapes: bodies are fills with every
// corner rounded to R, linear parts (the fan's arcs, the waves, the rune, the slash) strokes 2R wide with round ends. Every straight
// edge sits on a whole unit, so it is a hard pixel step at 100 % and 200 % (glyphModel.test.ts walks every path for it).

/** The network glyph: the cable, Wi-Fi off, on with no network, its signal in four steps, or no network at all. */
export type NetGlyphName = "wired" | "wifi-off" | "wifi-unlinked" | "wifi-0" | "wifi-1" | "wifi-2" | "wifi-3" | "offline";

/** The corner radius; a line is 2R wide, so its round ends are half circles of radius R too. */
export const R = 1;
/** The parts a level has not reached: high enough that the whole silhouette still shows over glass. */
export const DIM = 0.4;

const deg = Math.PI / 180;
const f = (n: number) => +n.toFixed(3);
/** The point r from (cx, cy) at angle a, in radians clockwise from straight up. */
const at = (cx: number, cy: number, r: number, a: number) => `${f(cx + r * Math.sin(a))} ${f(cy - r * Math.cos(a))}`;

/** An arc of radius r round (cx, cy) whose round ends, `cap` in radius (half the stroke), stay inside the angle a0..a1. */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, cap = R): string {
  const d = Math.asin(cap / r);
  return `M${at(cx, cy, r, a0 + d)}A${r} ${r} 0 0 1 ${at(cx, cy, r, a1 - d)}`;
}

/** A sector of radius r from its apex (cx, cy), between a0 and a1, every corner rounded to R. */
export function wedge(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const ta = R / Math.tan((a1 - a0) / 2), c = r - R, d = Math.asin(R / c), to = Math.sqrt(c * c - R * R);
  return (
    `M${at(cx, cy, ta, a0)}L${at(cx, cy, to, a0)}A${R} ${R} 0 0 1 ${at(cx, cy, r, a0 + d)}A${r} ${r} 0 0 1 ${at(cx, cy, r, a1 - d)}` +
    `A${R} ${R} 0 0 1 ${at(cx, cy, to, a1)}L${at(cx, cy, ta, a1)}A${R} ${R} 0 0 1 ${at(cx, cy, ta, a0)}Z`
  );
}

/** A polygon, its points clockwise, every corner rounded to R, or less where an edge is too short for it. */
export function poly(pts: [number, number][]): string {
  let d = "";
  pts.forEach((v, k) => {
    const p = pts[(k + pts.length - 1) % pts.length], q = pts[(k + 1) % pts.length];
    const ax = p[0] - v[0], ay = p[1] - v[1], bx = q[0] - v[0], by = q[1] - v[1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    const half = Math.acos((ax * bx + ay * by) / (la * lb)) / 2;
    const t = Math.min(R / Math.tan(half), la / 2, lb / 2), r = f(t * Math.tan(half));
    // A right turn rounds outwards, a left turn (a notch) inwards.
    d += `${k ? "L" : "M"}${f(v[0] + (ax / la) * t)} ${f(v[1] + (ay / la) * t)}A${r} ${r} 0 0 ${ax * by - ay * bx < 0 ? 1 : 0} ${f(v[0] + (bx / lb) * t)} ${f(v[1] + (by / lb) * t)}`;
  });
  return d + "Z";
}

/** A stadium of radius R round the segment (x0, y0)..(x1, y1), clockwise like every other body. */
export function capsule(x0: number, y0: number, x1: number, y1: number): string {
  const l = Math.hypot(x1 - x0, y1 - y0), nx = ((y0 - y1) / l) * R, ny = ((x1 - x0) / l) * R;
  return `M${f(x0 - nx)} ${f(y0 - ny)}L${f(x1 - nx)} ${f(y1 - ny)}A${R} ${R} 0 0 1 ${f(x1 + nx)} ${f(y1 + ny)}L${f(x0 + nx)} ${f(y0 + ny)}A${R} ${R} 0 0 1 ${f(x0 - nx)} ${f(y0 - ny)}Z`;
}

/** Off, or nothing there: the slash over the glyph, drawn after a cut of R either side of it. */
export const SLASH = "M2.5 2.5L13.5 13.5";

// The Wi-Fi fan as on an iPhone: a wedge of radius 4 and two arcs 2 wide, 2 apart, as Apple's proportions come out on the 16 grid
// (the arcs about 0.18 of the fan's radius, the gaps 0.15, the wedge a third).
/** The y of the fan's apex, where the arcs are centred. */
export const FAN_APEX_Y = 14;
/** The fan's two arcs, inner to outer; each outer edge (FAN_APEX_Y - r - R) sits on a whole unit, the top one on y 2. */
export const FAN_RADII = [7, 11] as const;
// 88 degrees wide: Apple's 90 or so, as far as the outer arc's round ends fit the 16 grid.
const FAN_A = 44 * deg;
export const FAN_WEDGE = wedge(8, FAN_APEX_Y, 4, -FAN_A, FAN_A);
export const FAN_ARCS: string[] = FAN_RADII.map((r) => arc(8, FAN_APEX_Y, r, -FAN_A, FAN_A));

/** The screen on its stand, one body 12 by 11, the screen a frame 2 wide round its hole (evenodd), so it weighs about as much as the fan. */
export const MONITOR =
  poly([[2, 3], [14, 3], [14, 10], [9, 10], [9, 12], [12, 12], [12, 14], [4, 14], [4, 12], [7, 12], [7, 10], [2, 10]]) +
  poly([[4, 5], [12, 5], [12, 8], [4, 8]]);
/** The globe, dimmed under the slash for no network. */
export const GLOBE = "M8 1.5A6.5 6.5 0 0 1 8 14.5A6.5 6.5 0 0 1 8 1.5Z";
/** The globe's one cut, 1 wide: a second one (the equator) made too many crumbs at 11 px. */
export const MERIDIAN = "M8 1.5A3 6.5 0 0 1 8 14.5A3 6.5 0 0 1 8 1.5Z";

// The speaker as on a Mac: one body, its back a box and its cone about as tall as the glyph (its corners at y 2 and 14 show it from
// about 2.9 to 13.1 once rounded), and three thin waves round the cone's middle, 66 degrees wide, the outer one a little taller than
// the cone. Muted, a slash through the body in the waves' weight.
/** The waves' and the mute slash's stroke, Apple's thin line (a tenth of the speaker's height). */
export const WAVE_W = 1.25;
/** The body for a glyph `px` device pixels tall: the box 5 tall on half units from 32 (sharp at 200 %), else 4 on whole units. */
export const speakerBody = (px: number) =>
  px >= 32 ? poly([[0, 5.5], [2.5, 5.5], [7, 2], [7, 14], [2.5, 10.5], [0, 10.5]]) : poly([[0, 6], [2.5, 6], [7, 2], [7, 14], [2.5, 10], [0, 10]]);
/** A wave per volume step round (5, 8), 2.6 apart. */
export const WAVES: string[] = [4.8, 7.4, 10].map((r) => arc(5, 8, r, 57 * deg, 123 * deg, WAVE_W / 2));
/** Muted: the slash from above the box to past the cone, crossing the cone's edge in its middle. */
export const MUTE = "M1 2L12 13";

// One slope, 6/11, for every diagonal, so the two long ones cross on the spine at y 8.
const SLOPE = 6 / 11;
/** The Bluetooth rune: its spine on x 7 from y 2 to 14, the tips on x 12.5 and the tails on x 2.5. */
export const RUNE = `M2.5 ${f(8 - 4.5 * SLOPE)}L12.5 11L7 14V2L12.5 5L2.5 ${f(8 + 4.5 * SLOPE)}`;

/** Airplane mode: the plane from above, nose up, fuselage 2 wide, swept wings and tail. */
export const PLANE = poly([[7, 1], [9, 1], [9, 5], [15, 9], [15, 11], [9, 10], [9, 12], [12, 14], [12, 15], [4, 15], [4, 14], [7, 12], [7, 10], [1, 11], [1, 9], [7, 5]]);
/** Energy saver: a square with two opposite corners rounded wide, tip up right, its stalk down left. */
export const LEAF = "M11 2H13A1 1 0 0 1 14 3V5A8 8 0 0 1 6 13H4A1 1 0 0 1 3 12V10A8 8 0 0 1 11 2Z" + capsule(1.5, 14.5, 4, 12);
/** The leaf's vein, cut out of it 1 wide. */
export const VEIN = "M4.5 11.5L10.5 5.5";

/** Which parts of the Wi-Fi fan are lit: the wedge and the first `arcs` arcs; the rest are dimmed. Three steps as on an iPhone, the
 *  two weakest of the four signals both the wedge alone. */
export function wifiLit(g: NetGlyphName): { wedge: boolean; arcs: number } {
  const n = ({ "wifi-0": 0, "wifi-1": 0, "wifi-2": 1, "wifi-3": 2 } as Partial<Record<NetGlyphName, number>>)[g];
  return n === undefined ? { wedge: false, arcs: 0 } : { wedge: true, arcs: n };
}

/** The speaker's waves: one per volume step, none when muted. */
export function speakerWaves(g: "muted" | "low" | "mid" | "high"): number {
  return { muted: 0, low: 1, mid: 2, high: 3 }[g];
}

/** The part between x = a and x = b of the rectangle x0..x1 by y0..y1 with its corners rounded to R. */
export function strip(x0: number, y0: number, x1: number, y1: number, a: number, b: number): string {
  const top = (x: number) => y0 + R - Math.sqrt(R * R - Math.max(0, x0 + R - x, x - x1 + R) ** 2);
  const bottom = (x: number) => y0 + y1 - top(x);
  const xs = [a, ...[x0 + R, x1 - R].filter((x) => x > a && x < b), b];
  const bent = (u: number, v: number) => v <= x0 + R || u >= x1 - R;
  let d = `M${f(a)} ${f(top(a))}`;
  for (let k = 1; k < xs.length; k++) d += bent(xs[k - 1], xs[k]) ? `A${R} ${R} 0 0 1 ${f(xs[k])} ${f(top(xs[k]))}` : `H${f(xs[k])}`;
  d += `V${f(bottom(b))}`;
  for (let k = xs.length - 1; k > 0; k--) d += bent(xs[k - 1], xs[k]) ? `A${R} ${R} 0 0 1 ${f(xs[k - 1])} ${f(bottom(xs[k - 1]))}` : `H${f(xs[k - 1])}`;
  return d + "Z";
}

/** A rectangle x0..x1 by y0..y1 with its corners rounded to r. */
const rounded = (x0: number, y0: number, x1: number, y1: number, r: number) =>
  `M${x0 + r} ${y0}H${x1 - r}A${r} ${r} 0 0 1 ${x1} ${y0 + r}V${y1 - r}A${r} ${r} 0 0 1 ${x1 - r} ${y1}H${x0 + r}A${r} ${r} 0 0 1 ${x0} ${y1 - r}V${y0 + r}A${r} ${r} 0 0 1 ${x0 + r} ${y0}Z`;

// The battery as on an iPhone, on the other glyphs' centre line: an outline round the body x 1..23, y 2..14, the charge a fill
// x 3..21, y 4..12 inside it with a gap all round, the cap a half ellipse beyond the same gap, and while charging a bolt across the
// body cut out of all of it with that gap again. Its width stays 26 in every state, so Stato keeps its size when the charger comes
// or goes. It is drawn for the screen: `px` is its height in device pixels (size * devicePixelRatio). From 32 (200 %) it takes
// Apple's proportions, the outline 1.5 and the gaps 0.5, on half units; below, the outline and the gaps are 1, on whole units.
export const BATTERY_W = 26;
/** Where the charge goes, 18 wide, its corners rounded to R: the same at every size. */
export const BATTERY_FILL = [3, 4, 21, 12] as const;
/** As tall as the body, sharp like every bolt, its jog on y 8. */
export const BATTERY_BOLT = "M14 2L13 8H16L10 14L11 8H8Z";

const half = (px: number) => px >= 32;

/** The outline (the body's outer edge, corners 3, and its inner one, filled evenodd), the cap, and the cut round the bolt (a
 *  stroke twice the gap). */
export function batteryShape(px: number): { shell: string; cap: string; cut: number } {
  return half(px)
    ? { shell: rounded(1, 2, 23, 14, 3) + rounded(2.5, 3.5, 21.5, 12.5, 1.5), cap: "M23.5 6A1.75 2 0 0 1 23.5 10Z", cut: 1 }
    : { shell: rounded(1, 2, 23, 14, 3) + rounded(2, 3, 22, 13, 2), cap: "M24 6A1.5 2 0 0 1 24 10Z", cut: 2 };
}

/** ceil(size * 26 / 16): a whole px, so what follows Stato stays on whole pixels. */
export const batteryWidth = (size: number) => Math.ceil((size * BATTERY_W) / 16);

/** Lit width over the fill's 18: 18 only at 100, at most a step less below, at least 2 while charge is left; null when unknown.
 *  A step is a unit, half a unit from 32 device px, so the level's edge lands on a device pixel. */
export function batteryFill(percent: number | null, px: number): number | null {
  if (percent === null) return null;
  const p = Math.round(percent);
  if (p >= 100) return 18;
  const step = half(px) ? 0.5 : 1;
  const w = Math.min(18 - step, Math.max(0, Math.round((p * 0.18) / step) * step));
  return p > 0 ? Math.max(2, w) : w;
}

export type BatteryTint = "red" | "yellow" | "green" | null;
/** As on an iPhone: Energy saver yellow like Low Power Mode, also while charging, else charging green. A warning's red wins: Windows
 *  turns Energy saver on under 20 %, and a battery about to run out must not read calm. */
export const batteryTint = (warning: boolean, saver: boolean, charging: boolean): BatteryTint => (warning ? "red" : saver ? "yellow" : charging ? "green" : null);
