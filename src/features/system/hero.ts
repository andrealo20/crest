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
  "taskbar-apps": [12, 0.05],
  "taskbar-look": [10, 0.06],
  search: [7, 0.12],
};

/** The settings navigation's mark for a page: 4..12 lobes, amplitude 0.05..0.15. */
export function brandOf(id: string): [lobes: number, amplitude: number] {
  const mark = MARKS[id];
  if (mark) return [mark[0], mark[1]];
  const h = idHash(id);
  return [4 + (h % 9), 0.05 + ((h >>> 8) % 11) / 100];
}
