import type { Zone } from "./model.ts";

/** An item on the bar other than the apps, at its width; `gives` marks what may leave when the bar is too narrow. */
export interface FitEntry { id: string; w: number; gives?: "tray" | "widget" }
/** What the bar measured: everything `fitBar` needs, in CSS px. */
export interface FitMeasure {
  /** The room inside the bar: innerWidth - 2 * barGap(shape) - 8. */
  inner: number;
  /** Between two items: itemGap(shape). */
  gap: number;
  /** The capsule: every zone in one row. */
  row: boolean;
  /** The zone holding the apps, null without them. */
  apps: Zone | null;
  /** Every item but the apps, in order, hidden ones at their last width. */
  zones: Record<Zone, FitEntry[]>;
  /** App buttons. */
  count: number;
  /** An app button's width at full size. */
  full: number;
  /** And narrow (also the "…" button's). */
  compact: number;
  /** Under "When full" and "Never": the buttons one per window (`count`), how many of them have a window (`titled`; the rest are pinned apps with none), a titled button's width range, and whether to stay one per window when titles do not fit (`never`). Null under "Always". */
  split: { count: number; titled: number; min: number; max: number; never: boolean } | null;
}
/**
 * How the apps are drawn: `visible` apps (all unless overflowing), the tray's kept icons back behind ^, the widgets hidden; `split`, one
 * button per window (windowButtons); `label`, a titled button's width in "labels" mode, 0 otherwise.
 */
export interface Fit { mode: "labels" | "full" | "compact" | "overflow"; visible: number; trayBack: boolean; hide: string[]; split: boolean; label: number }

/** Growing back needs this many px more than shrinking, so a few pixels never move an app or a widget in and out. */
export const FIT_MARGIN = 24;

const cost = (list: FitEntry[], gap: number) => list.reduce((n, x) => n + x.w + gap, 0);

/** What gives way when one app and "…" do not fit, in order: the tray's kept icons, then the side zones' widgets farthest from the centre first (a tie: the right zone's), then the centre's, last first. */
function steps(z: Record<Zone, FitEntry[]>, gap: number): string[] {
  const side: { id: string; out: number }[] = [];
  // The farther an outer edge is from the centre, the less there is between it and the bar's end.
  z.right.forEach((x, i) => x.gives === "widget" && side.push({ id: x.id, out: cost(z.right.slice(i + 1), gap) }));
  z.left.forEach((x, i) => x.gives === "widget" && side.push({ id: x.id, out: cost(z.left.slice(0, i), gap) }));
  side.sort((a, b) => a.out - b.out);
  const centre = z.center.filter((x) => x.gives === "widget").map((x) => x.id).reverse();
  const tray = [...z.left, ...z.center, ...z.right].some((x) => x.gives === "tray") ? ["tray"] : [];
  return [...tray, ...side.map((x) => x.id), ...centre];
}

/** How the bar's apps fit, from what was measured and the last fit (null at first): with titles, full size, narrow, or the last ones behind "…", and what the other items give up when even one app and "…" do not fit. */
export function fitBar(m: FitMeasure, was: Fit | null): Fit {
  const order = steps(m.zones, m.gap);
  const never = m.split?.never === true;
  const n = never ? m.split!.count : m.count;
  const apps = m.apps ? n : 0;
  // A row of n items takes n - 1 gaps; the apps' row counts its buttons among them, each charged its gap in `P` or `p` below.
  const span = (list: FitEntry[], withApps: boolean) => (list.length || (withApps && apps > 0) ? cost(list, m.gap) - m.gap : 0);
  const room = (k: number) => {
    const gone = new Set(order.slice(0, k));
    const keep = (z: Zone) => m.zones[z].filter((x) => !(x.gives === "tray" ? gone.has("tray") : gone.has(x.id)));
    if (m.row) return m.inner - span([...keep("left"), ...keep("center"), ...keep("right")], true);
    const [l, c, r] = [span(keep("left"), m.apps === "left"), span(keep("center"), m.apps === "center"), span(keep("right"), m.apps === "right")];
    // Apps in the centre keep it centred: the wider side counts on both sides.
    return m.apps === "left" || m.apps === "right" ? m.inner - l - c - r : m.inner - 2 * Math.max(l, r) - c;
  };
  const P = m.full + m.gap;
  const p = m.compact + m.gap;
  const min = apps === 0 ? 0 : apps === 1 ? p : 2 * p;
  let wasK = 0;
  while (was && wasK < order.length && (order[wasK] === "tray" ? was.trayBack : was.hide.includes(order[wasK]))) wasK++;
  let k = 0;
  while (k < order.length && room(k) < min + (k < wasK ? FIT_MARGIN : 0)) k++;
  const R = room(k);
  const taken = order.slice(0, k);
  const out = (mode: Fit["mode"], visible: number, split = never, label = 0): Fit => ({ mode, visible, trayBack: taken.includes("tray"), hide: taken.filter((x) => x !== "tray"), split, label });
  // Titles while every button fits at least `min` wide: pinned apps with no window keep their icon's width; coming back from icons takes FIT_MARGIN more.
  const s = m.split;
  if (s && m.apps && s.titled > 0) {
    const icons = (s.count - s.titled) * P;
    const w = Math.min(s.max, Math.floor((R - icons - (was && was.mode !== "labels" ? FIT_MARGIN : 0)) / s.titled) - m.gap);
    if (w >= s.min) return out("labels", s.count, true, w);
  }
  if (apps === 0 || apps * P <= R - (was && (was.mode === "compact" || was.mode === "overflow") ? FIT_MARGIN : 0)) return out("full", n);
  if (apps < 2 || apps * p <= R - (was?.mode === "overflow" ? FIT_MARGIN : 0)) return out("compact", n);
  let v = Math.floor((R - p) / p);
  if (was?.mode === "overflow" && v > was.visible) v = Math.max(was.visible, Math.floor((R - FIT_MARGIN - p) / p));
  return out("overflow", Math.min(apps - 1, Math.max(1, v)));
}

/** Which apps the bar shows when only `visible` fit: the last ones go first, and the `kept` ones (the app in front, then those asking for attention) take the last places shown. Both lists keep the bar's order. */
export function splitApps(keys: string[], visible: number, kept: string[]): { shown: string[]; hidden: string[] } {
  const head = keys.slice(0, visible);
  const want = [...new Set(kept)];
  const removable = head.filter((k) => !want.includes(k));
  const promoted = want.filter((k) => keys.includes(k) && !head.includes(k)).slice(0, removable.length);
  const out = new Set(removable.slice(removable.length - promoted.length));
  const show = new Set([...head.filter((k) => !out.has(k)), ...promoted]);
  const shown = keys.filter((k) => show.has(k));
  return { shown, hidden: keys.filter((k) => !show.has(k)) };
}
