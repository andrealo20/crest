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

/** A stadium of radius R round the segment (x0, y0)..(x1, y1), clockwise like every other body. */
export function capsule(x0: number, y0: number, x1: number, y1: number): string {
  const l = Math.hypot(x1 - x0, y1 - y0), nx = ((y0 - y1) / l) * R, ny = ((x1 - x0) / l) * R;
  return `M${f(x0 - nx)} ${f(y0 - ny)}L${f(x1 - nx)} ${f(y1 - ny)}A${R} ${R} 0 0 1 ${f(x1 + nx)} ${f(y1 + ny)}L${f(x0 + nx)} ${f(y0 + ny)}A${R} ${R} 0 0 1 ${f(x0 - nx)} ${f(y0 - ny)}Z`;
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

/** Airplane mode: the plane from above, nose up, fuselage 2 wide, swept wings and tail. */
export const PLANE = poly([[7, 1], [9, 1], [9, 5], [15, 9], [15, 11], [9, 10], [9, 12], [12, 14], [12, 15], [4, 15], [4, 14], [7, 12], [7, 10], [1, 11], [1, 9], [7, 5]]);
/** Energy saver: a square with two opposite corners rounded wide, tip up right, its stalk down left. */
export const LEAF = "M11 2H13A1 1 0 0 1 14 3V5A8 8 0 0 1 6 13H4A1 1 0 0 1 3 12V10A8 8 0 0 1 11 2Z" + capsule(1.5, 14.5, 4, 12);
/** The leaf's vein, cut out of it 1 wide. */
export const VEIN = "M4.5 11.5L10.5 5.5";

/** Which parts of the Wi-Fi fan are lit: the wedge and the first `arcs` arcs; the rest are dimmed. */
export function wifiLit(g: NetGlyphName): { wedge: boolean; arcs: number } {
  const n = ({ "wifi-0": 0, "wifi-1": 1, "wifi-2": 2, "wifi-3": 3 } as Partial<Record<NetGlyphName, number>>)[g];
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

// The battery, the charge written in it, on the other glyphs' centre line: the body x 1..21, y 2..14, the cap x 22..24, y 5..11,
// lit only at 100. Its width stays 27 in every state, so Stato keeps its size when the charger comes or goes. It is drawn for the
// screen: `px` is its height in device pixels (size * devicePixelRatio), and batteryScale says what follows.
export const BATTERY_W = 27;
export const BATTERY_BODY = [1, 2, 21, 14] as const;
export const BATTERY_CAP = poly([[22, 5], [24, 5], [24, 11], [22, 11]]);
/** Charging beside the number, in the cap's place: as tall as the body, sharp like every bolt, its jog on y 8. */
export const BATTERY_BOLT = "M26.5 2L25.5 8H27L22.5 14L23.5 8H22Z";
/** Charging where the number does not fit: the bolt in the middle of the body, and the cap stays. */
export const BODY_BOLT = "M13 2L12 8H15L9 14L10 8H7Z";
/** Unknown: a dash in the number's place. */
export const BATTERY_DASH = strip(8, 7, 14, 9, 8, 14);
/** The number in Inter, bold, tabular figures: digits 7 units tall (cap height 0.7275 em). */
export const NUMBER_SIZE = f(7 / 0.7275);
/** A tabular digit's advance, 0.6465 em in Inter. */
const DIGIT_ADVANCE = 0.6465 * NUMBER_SIZE;

/** ceil(size * 27 / 16): a whole px, so what follows Stato stays on whole pixels. */
export const batteryWidth = (size: number) => Math.ceil((size * BATTERY_W) / 16);

/** From the battery's height in device px: the number from 14, half units and baseline 11.5 from 32 (the renderer puts a baseline
 *  on a whole pixel, so 11.5 below would land on 12), the cut round what is drawn over the body one device px, never under 0.5. */
export function batteryScale(px: number): { number: boolean; half: boolean; cut: number; baseline: 11 | 11.5 } {
  const half = px >= 32;
  return { number: px >= 14, half, cut: Math.max(0.5, 16 / px), baseline: half ? 11.5 : 11 };
}

/** Lit width over x 1..21: 20 only at 100, at most a step less below, at least 2 while charge is left; null when unknown. */
export function batteryWideFill(percent: number | null, px: number): number | null {
  if (percent === null) return null;
  const p = Math.round(percent);
  if (p >= 100) return 20;
  const step = batteryScale(px).half ? 0.5 : 1;
  const w = Math.min(20 - step, Math.max(0, Math.round((p * 0.2) / step) * step));
  return p > 0 ? Math.max(2, w) : w;
}

/** The red of a warning wins over Energy saver's green: Windows turns Energy saver on under 20 %, and a battery about to run out
 *  must not read green. */
export const batteryTint = (warning: boolean, saver: boolean): "red" | "green" | null => (warning ? "red" : saver ? "green" : null);

/** Each digit of round(percent), centred in its tabular cell round x 11; `inked` when written in its cut, else cut out of the body.
 *  A digit whose cell's middle is lit is cut out, else inked, so no digit changes ink inside itself; on a tinted body every digit
 *  is inked (a hole in red or green shows the backdrop against a colour), but not at 100, which leaves no room for a cut. */
export function batteryDigits(percent: number, fill: number, tinted: boolean): { d: string; x: number; inked: boolean }[] {
  const digits = [...String(Math.round(percent))];
  return digits.map((d, i) => {
    const x = f(11 + (i - (digits.length - 1) / 2) * DIGIT_ADVANCE);
    return { d, x, inked: !(x < 1 + fill && (!tinted || fill === 20)) };
  });
}
