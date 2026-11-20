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

/** An arc of radius r round (cx, cy) whose round ends stay inside the angle a0..a1. */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const d = Math.asin(R / r);
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

/** Off, or nothing there: the slash over the glyph, drawn after a cut of R either side of it. */
export const SLASH = "M2.5 2.5L13.5 13.5";

/** The y of the fan's apex, where the arcs are centred. */
export const FAN_APEX_Y = 14.5;
/** The fan's three arcs, inner to outer, 1 apart; each outer edge (FAN_APEX_Y - r - R) sits on a whole unit. */
export const FAN_RADII = [5.5, 8.5, 11.5] as const;
// 80 degrees wide: 90 with 2 unit strokes does not fit the 16 grid.
const FAN_A = 40 * deg;
export const FAN_WEDGE = wedge(8, FAN_APEX_Y, 3.5, -FAN_A, FAN_A);
export const FAN_ARCS: string[] = FAN_RADII.map((r) => arc(8, FAN_APEX_Y, r, -FAN_A, FAN_A));

/** The screen on its stand, one body 12 by 11, the screen a frame 2 wide round its hole (evenodd), so it weighs about as much as the fan. */
export const MONITOR =
  poly([[2, 3], [14, 3], [14, 10], [9, 10], [9, 12], [12, 12], [12, 14], [4, 14], [4, 12], [7, 12], [7, 10], [2, 10]]) +
  poly([[4, 5], [12, 5], [12, 8], [4, 8]]);
/** The globe, dimmed under the slash for no network. */
export const GLOBE = "M8 1.5A6.5 6.5 0 0 1 8 14.5A6.5 6.5 0 0 1 8 1.5Z";
/** The globe's one cut, 1 wide: a second one (the equator) made too many crumbs at 11 px. */
export const MERIDIAN = "M8 1.5A3 6.5 0 0 1 8 14.5A3 6.5 0 0 1 8 1.5Z";

/** The speaker, one body. */
export const SPEAKER = poly([[1, 6], [3, 6], [6, 3], [6, 13], [3, 10], [1, 10]]);
/** A wave per volume step round (4, 8), the fan's thickness and gaps, 70 degrees wide so the outer one spans the fan's height. */
export const WAVES: string[] = [4.5, 7.5, 10.5].map((r) => arc(4, 8, r, 55 * deg, 125 * deg));
/** Muted: a cross where the waves were, since a slash would cut the cone apart. */
export const MUTE = "M9 5.5L14 10.5M14 5.5L9 10.5";

// One slope, 6/11, for every diagonal, so the two long ones cross on the spine at y 8.
const SLOPE = 6 / 11;
/** The Bluetooth rune: its spine on x 7 from y 2 to 14, the tips on x 12.5 and the tails on x 2.5. */
export const RUNE = `M2.5 ${f(8 - 4.5 * SLOPE)}L12.5 11L7 14V2L12.5 5L2.5 ${f(8 + 4.5 * SLOPE)}`;

/** Which parts of the Wi-Fi fan are lit: the wedge and the first `arcs` arcs; the rest are dimmed. */
export function wifiLit(g: NetGlyphName): { wedge: boolean; arcs: number } {
  const n = ({ "wifi-0": 0, "wifi-1": 1, "wifi-2": 2, "wifi-3": 3 } as Partial<Record<NetGlyphName, number>>)[g];
  return n === undefined ? { wedge: false, arcs: 0 } : { wedge: true, arcs: n };
}

/** The speaker's waves: one per volume step, none when muted. */
export function speakerWaves(g: "muted" | "low" | "mid" | "high"): number {
  return { muted: 0, low: 1, mid: 2, high: 3 }[g];
}

/** The battery's fill width in px (0..9, half px steps), at least half a px while charge is left; full when the level is unknown. */
export function batteryFill(percent: number | null): number {
  if (percent === null) return 9;
  const w = Math.min(9, Math.max(0, Math.round((percent / 100) * 18) / 2));
  return percent > 0 ? Math.max(0.5, w) : w;
}
