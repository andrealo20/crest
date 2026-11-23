import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { fitBar, type Fit, type FitEntry, type FitMeasure } from "../fit";
import { barGap, itemGap } from "../look";
import { COMPACT_PAD, compactIcon, trayIcon, type BarItem, type BarShape, type Zone } from "../model";
import { isSys, isTool, isWidget, sysPrimaryOnly } from "../widgets";

const ZONES: Zone[] = ["left", "center", "right"];
/** The fit and the widths of the hidden items (`hideW`, in `hide`'s order), for the panel that shows them. */
export type BarFit = Fit & { hideW: number[] };
const same = (a: BarFit, b: BarFit) =>
  a.mode === b.mode && a.visible === b.visible && a.trayBack === b.trayBack && a.hide.join() === b.hide.join() && a.split === b.split && a.label === b.label && a.hideW.join() === b.hideW.join();

/**
 * How the bar's apps fit (fit.ts), from what the bar holds and the widths its items have: each item other than the apps is measured
 * by its `data-kind` elements, summed, and remembered while it is hidden; the tray's slots are worked out. A zone's own width is never
 * read, as a squeezed zone gives a width it does not need. It measures again when what the bar holds changes, when an item changes
 * width (a temperature, a caption) and on a resize of the window; nothing runs between those. `scale` is the widgets' (widgetScale):
 * a hidden widget's remembered width follows it.
 */
export function useAppFit(
  bar: RefObject<HTMLElement | null>,
  i: { zones: Record<Zone, BarItem[]>; shape: BarShape; size: number; scale: number; count: number; trayCount: number; primary: boolean; clockAll: boolean; glyphs: number; split: FitMeasure["split"] },
): BarFit {
  const widths = useRef(new Map<string, number>());
  const scaled = useRef(i.scale);
  const was = useRef<Fit | null>(null);
  const [fit, setFit] = useState<BarFit>(() => ({ mode: "full", visible: i.count, trayBack: false, hide: [], split: false, label: 0, hideW: [] }));
  // As of the last render, for the measures the observers make.
  const now = useRef(i);
  const measure = useCallback(() => {
    const el = bar.current;
    if (!el) return;
    const { zones, shape, size, scale, count, trayCount, primary, clockAll, split } = now.current;
    // A hidden widget's remembered width follows the widgets' scale, the 8 px a side its button keeps staying (widgets.ts widgetWidth).
    // shortcut: a widget on Stato's pill keeps the pill's sides instead, a few px off until it shows again; remember the body's width if that ever moves one in and out.
    if (scale !== scaled.current) for (const [id, w] of widths.current) if (isWidget(id)) widths.current.set(id, ((w - 16) * scale) / scaled.current + 16);
    scaled.current = scale;
    const slot = shape === "tiles" ? size + 16 : trayIcon(size) + 16;
    const entries = (id: BarItem): FitEntry[] => {
      if (id === "apps") return [];
      if (id === "tray") return [...Array.from({ length: trayCount }, () => ({ id: "tray", w: slot, gives: "tray" as const })), { id: "tray-more", w: slot }];
      // A bar on another monitor draws neither widgets nor tool buttons, nor Windows widgets; the clock with clockAll.
      if ((isWidget(id) || isTool(id) || (isSys(id) && sysPrimaryOnly(id))) && !primary && !(id === "clock" && clockAll)) return [];
      const found = el.querySelectorAll<HTMLElement>(`[data-kind="${id}"]`);
      if (found.length) widths.current.set(id, [...found].reduce((n, x) => n + x.offsetWidth, 0));
      return [{ id, w: widths.current.get(id) ?? 0, gives: isWidget(id) || isTool(id) || isSys(id) ? "widget" : undefined }];
    };
    const next = fitBar(
      {
        inner: innerWidth - 2 * barGap(shape) - 8,
        gap: itemGap(shape),
        row: shape === "capsule",
        apps: ZONES.find((z) => zones[z].includes("apps")) ?? null,
        zones: { left: zones.left.flatMap(entries), center: zones.center.flatMap(entries), right: zones.right.flatMap(entries) },
        count,
        full: size + 16,
        compact: compactIcon(size) + COMPACT_PAD,
        split,
        // The button in the first hidden item's place, as wide as a tool button (TaskbarWindow).
        more: slot,
      },
      was.current,
    );
    was.current = next;
    const both = { ...next, hideW: next.hide.map((id) => widths.current.get(id) ?? 0) };
    setFit((f) => (same(f, both) ? f : both));
  }, [bar]);
  const key = `${JSON.stringify(i.zones)}|${i.shape}|${i.size}|${i.scale}|${i.count}|${i.trayCount}|${i.primary}|${i.clockAll}|${i.glyphs}|${JSON.stringify(i.split)}`;
  useLayoutEffect(() => {
    now.current = i;
    measure();
    // `key` stands for `i`, a new object on every render.
  }, [key, measure]);
  // Again on each fit, as hidden items come back and shown ones go.
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    el.querySelectorAll("[data-kind]").forEach((x) => observer.observe(x));
    addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      removeEventListener("resize", measure);
    };
  }, [bar, measure, key, fit]);
  return fit;
}
