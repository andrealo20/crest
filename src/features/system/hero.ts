// Shapes from Stellaria (GPL-3.0, github.com/SMIDR76/stellaria-windows) at dcc2f10: pack/src/core/dom.js (shapes, polarShapePath),
// the load thresholds of pack/dashboard.js:363, and the page shapes of launcher/ui/launcher.js:251-254 (pageShapes).
// Modified for Crest, 2026-11-21: 120 points instead of 240, shapes mixed point by point on Crest's springs, a dead band
// around the thresholds, page shapes for Crest's pages, systemFit, niceMax and the graph's paths.

export const SHAPES = { cookie4: [4, 0.12], sunny: [8, 0.075], softBurst: [10, 0.11] } as const;
export type ShapeName = keyof typeof SHAPES;
const STEPS = 120;

/** FNV-1a, 32 bits: the fallback for ids no table names. */
export function idHash(id: string): number {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** A polar shape's outline in a 100 x 100 box as x, y pairs: the same count for every shape, so two can be mixed point by point. */
export function shapePoints(lobes: number, amplitude: number): number[] {
  const rotation = -Math.PI / 2 / lobes;
  const points: number[] = [];
  for (let i = 0; i < STEPS; i++) {
    const angle = (i / STEPS) * 2 * Math.PI;
    const r = (50 / (1 + amplitude)) * (1 + amplitude * Math.cos(lobes * (angle + rotation)));
    points.push(50 + r * Math.cos(angle), 50 + r * Math.sin(angle));
  }
  return points;
}

/** A rounded square (a squircle, |x|^4 + |y|^4 = 1) in the same 100 x 100 box with as many points, its sides touching the box. */
export function squarePoints(): number[] {
  const points: number[] = [];
  for (let i = 0; i < STEPS; i++) {
    const angle = (i / STEPS) * 2 * Math.PI;
    const r = 50 / (Math.abs(Math.cos(angle)) ** 4 + Math.abs(Math.sin(angle)) ** 4) ** 0.25;
    points.push(50 + r * Math.cos(angle), 50 + r * Math.sin(angle));
  }
  return points;
}

/** A polar shape as the Material shapes setting draws it: Material's wavy one, a circle (no lobes) or a rounded square. */
export function styledPoints(style: "wavy" | "circle" | "square", lobes: number, amplitude: number): number[] {
  // A circle is one lobe of no amplitude: no lobes at all would divide by zero.
  return style === "circle" ? shapePoints(1, 0) : style === "square" ? squarePoints() : shapePoints(lobes, amplitude);
}

export function mixPoints(a: number[], b: number[], t: number): number[] {
  return a.map((n, i) => n * (1 - t) + b[i] * t);
}

export function pathOf(points: number[]): string {
  let d = "";
  for (let i = 0; i < points.length; i += 2) d += `${i ? " L" : "M"}${points[i].toFixed(2)},${points[i + 1].toFixed(2)}`;
  return `${d} Z`;
}

const RANK: Record<ShapeName, number> = { cookie4: 0, sunny: 1, softBurst: 2 };

/** The shape for a load: up at 40 and 80 %, down only under 35 and 75 %, so a load around a threshold does not flip it every second. */
export function loadShape(prev: ShapeName, percent: number | null): ShapeName {
  if (percent === null) return "cookie4";
  const up: ShapeName = percent >= 80 ? "softBurst" : percent >= 40 ? "sunny" : "cookie4";
  const down: ShapeName = percent < 35 ? "cookie4" : percent < 75 ? "sunny" : "softBurst";
  if (RANK[up] > RANK[prev]) return up;
  if (RANK[down] < RANK[prev]) return down;
  return prev;
}

// The first eight are Stellaria's pageShapes; the bar's pages repeat the notch page that says the same, never two alike in a row.
export const MARKS: Record<string, readonly [lobes: number, amplitude: number]> = {
  general: [9, 0.07],
  display: [6, 0.1],
  window: [12, 0.05],
  tools: [4, 0.13],
  timer: [7, 0.09],
  ai: [5, 0.15],
  accounts: [8, 0.08],
  themes: [10, 0.06],
  notices: [11, 0.07],
  plugins: [6, 0.12],
  taskbar: [9, 0.07],
  "taskbar-items": [5, 0.1],
  "taskbar-widgets": [8, 0.11],
  "taskbar-apps": [12, 0.05],
  "taskbar-look": [10, 0.06],
  search: [7, 0.12],
};

/** The settings navigation's mark for a page: 4..12 lobes, amplitude 0.05..0.15. */
export function brandOf(id: string): [lobes: number, amplitude: number] {
  const mark = MARKS[id];
  if (mark) return [mark[0], mark[1]];
  const h = idHash(id);
  return [4 + (h % 9), (5 + ((h >>> 8) % 11)) / 100];
}

/** What the Material hardware shows in a body of w x h CSS px: the cores go first, then the three tiles fold into a row of chips. */
export function systemFit(
  w: number,
  h: number,
): { cores: boolean; tiles: "cards" | "chips"; rows: number; ring: 64 | 76 | 96; shape: 48 | 60 | 72; tempBar: boolean } {
  return {
    cores: h >= 280,
    tiles: h >= 258 ? "cards" : "chips",
    // The rows that fit the processes card: its grid row (the RAM and drive row keeps its 104 px) less the 28 px header and pb-1, 24 px each.
    rows: Math.min(8, Math.max(2, Math.floor((h - 8 - Math.max(104, ((h - 8) * 126) / 278) - 32) / 24))),
    ring: h >= 420 ? 96 : h >= 280 ? 76 : 64,
    shape: h >= 420 ? 72 : h >= 280 ? 60 : 48,
    tempBar: w >= 600,
  };
}

/** The network graph's scale target, at least 1 MB/s and rounded up to 1, 2 or 5 times a power of ten, so it changes only when the traffic crosses one. */
export function niceMax(values: readonly number[]): number {
  const top = Math.max(1e6, ...values.filter(Number.isFinite));
  const p = 10 ** Math.floor(Math.log10(top));
  return [p, 2 * p, 5 * p].find((n) => n >= top) ?? 10 * p;
}

// The graph's points, one run per stretch without a gap: right = now, and the newest point one step past w, where the scroll brings it in.
function runs(values: number[], max: number, w: number, h: number, slots: number): [x: string, y: string][][] {
  const step = w / (slots - 2);
  const offset = slots - values.length;
  const out: [string, string][][] = [];
  let run: [string, string][] | null = null;
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) return void (run = null);
    if (!run) out.push((run = []));
    run.push([((offset + i) * step).toFixed(1), (h - 2 - (Math.min(v, max) / max) * (h - 4)).toFixed(1)]);
  });
  return out;
}

/** The history line in a w x h box; the pen lifts over a sample with no value. */
export function trendLine(values: number[], max: number, w: number, h: number, slots: number): string {
  return runs(values, max, w, h, slots)
    .map((run) => run.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(""))
    .join("");
}

/** The area under the history line, each run closed down to the base. */
export function trendArea(values: number[], max: number, w: number, h: number, slots: number): string {
  const base = h.toFixed(1);
  return runs(values, max, w, h, slots)
    .map((run) => `M${run[0][0]},${base}${run.map(([x, y]) => `L${x},${y}`).join("")}L${run[run.length - 1][0]},${base}Z`)
    .join("");
}
