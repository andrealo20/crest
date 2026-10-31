import { useRef, useState } from "react";
import { isNative } from "../platform/native";
import { display } from "../platform/services";
import { settings, updateSettings } from "../settings/store";
import { snapCapsule, windowYFor } from "./capsule";
import { alongOf, anchorAt, edgeLine, frameFor, nearestEdge, pointToScreen, pointerIn, span, type Dock, type Edge, type Work } from "./edge";
import { focusMode } from "./focus";
import { monitorMetrics, reloadMonitor } from "./monitor";
import { holdOpen, type NotchStatus } from "./useNotchState";

/** Below this distance it's a click, not a drag. */
const THRESHOLD = 6;
/** The notch snaps to the center when close to it. */
const SNAP = 24;

type Style = "notch" | "capsule" | "line";

/** The closed look on screen: the focus line overrides the idle style. */
export function shownStyle(s = settings.get()): Style {
  return focusMode.get() && s.display.focusStyle === "line" ? "line" : s.display.idleStyle;
}

/** The edge in use: the notch and the line hang from the chosen one, the capsule always floats on the top frame. */
export const edgeOf = (style: Style, dock: Dock): Edge => (style === "capsule" ? "top" : dock.edge);

type Metrics = ReturnType<typeof monitorMetrics>;
const workOf = (m: Metrics): Work => ({ x: m.workLeft, y: m.workTop, width: m.workWidth, height: m.workHeight });

/** Where the frame of the notch's edge starts on its monitor (CSS px from its top or left); 0 for the capsule. */
export function dockLine(dock = settings.get().dock, style = shownStyle(), m: Metrics = monitorMetrics()): number {
  return style === "capsule" ? 0 : edgeLine(dock.edge, dock.anchor, m.width, m.height, workOf(m));
}

/** The window's top for the capsule top `y` (display.y unless given) on the notch's monitor; always finite, since Rust rejects NaN. */
export function windowY(y = settings.get().display.y): number {
  const s = settings.get(), m = monitorMetrics();
  const top = windowYFor(shownStyle(s), y, m.height, m.workTop);
  return Number.isFinite(top) ? top : 0;
}

/** What Rust places the window by, beyond the saved display settings; for noticing changes. */
export const placementKey = () => `${windowY()}|${edgeOf(shownStyle(), settings.get().dock)}|${dockLine()}`;

/** Sends display settings to Rust, optionally with an offset, a capsule top `y` and a dock that aren't saved yet (Rust gets the window's top from `windowY`). */
export function applyDisplay(offset = settings.get().display.offset, y?: number, dock = settings.get().dock) {
  const s = settings.get(), style = shownStyle(s), edge = edgeOf(style, dock), line = dockLine(dock, style);
  // On top the window's top is windowY (0 for the notch), or the edge of a taskbar on top it hangs from.
  const top = style === "capsule" ? windowY(y) : edge === "top" ? line : 0;
  display.apply({ hideFullscreen: s.display.visibility === "hide-fullscreen", monitor: s.display.monitor, offset, y: top, gaming: s.gaming.mode !== "off", edge, line });
}

/** The area the notch is dragged in: the monitor, in the browser the viewport with DesktopMock's 48 px taskbar. */
export function dragArea(): Metrics {
  if (isNative) return monitorMetrics();
  return { width: window.innerWidth, height: window.innerHeight, workTop: 0, workHeight: window.innerHeight - 48, workLeft: 0, workWidth: window.innerWidth };
}

/** The dock's frame line in the browser view, where the viewport stands in for the monitor. */
export const viewLine = (dock: Dock) => {
  const m = dragArea();
  return edgeLine(dock.edge, dock.anchor, m.width, m.height, workOf(m));
};

/*
 * Move the notch along its edge, the capsule anywhere: grab it anywhere when closed, by the
 * header when open. Closed, the notch and the line move to the edge nearest the pointer (with
 * hysteresis), hanging from the screen's edge over a taskbar and from the taskbar's edge elsewhere.
 * Natively the window itself moves (display.rs, clamped to the monitor), in the browser only
 * the notch inside the window. Saved on release. `shape` gives the closed shape, which the capsule snaps with.
 */
export function useDragToMove(status: NotchStatus, shape: () => { w: number; h: number }) {
  const s = settings.use(), saved = s.display;
  const [live, setLive] = useState<{ offset: number; y: number; dock: Dock } | null>(null);
  const moved = useRef(false);
  const offset = live?.offset ?? saved.offset;
  const y = live?.y ?? saved.y;
  const dock = live?.dock ?? s.dock;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    if (target.closest("button, input, textarea, a, [role=slider], [data-no-drag]")) return;
    // When open only via the header, otherwise lists and sliders would drag too.
    if (status === "open" && !target.closest("[data-drag-handle]")) return;

    const capsule = saved.idleStyle === "capsule";
    reloadMonitor();
    const { pointerId: id, screenX: x, screenY: sy } = e;
    const from = { offset, y, dock };
    let current = from;
    let frame = 0;
    moved.current = false;

    // Where the pointer is on the monitor: the notch's place on its edge plus the pointer's place in the hit zone, which hangs from the edge.
    const m0 = dragArea(), work0 = workOf(m0), edge0 = from.dock.edge;
    const hit = document.querySelector("[data-notch-hit]")?.getBoundingClientRect();
    const rel = hit ? pointerIn(edge0, hit, e.clientX, e.clientY) : { depth: 0, along: 0 };
    const grab = pointToScreen(frameFor(edge0, from.dock.anchor, m0.width, m0.height, work0), span(edge0, m0.width, m0.height) / 2 + from.offset + rel.along, rel.depth);

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const dx = ev.screenX - x, dy = ev.screenY - sy;
      if (!moved.current && Math.max(Math.abs(dx), Math.abs(dy)) < THRESHOLD) return;
      if (!moved.current) {
        moved.current = true;
        holdOpen(true);
      }
      const m = dragArea();
      if (capsule) {
        const size = shape(), left = m.width / 2 - size.w / 2;
        const c = snapCapsule(left + from.offset + dx, from.y + dy, size.w, size.h, m.width, m.height, { top: m.workTop, height: m.workHeight });
        current = { offset: Math.round(c.x - left), y: Math.round(c.y), dock: from.dock };
      } else {
        const p = { x: grab.x + dx, y: grab.y + dy }, work = workOf(m);
        // Open, it stays on its edge: the panel would jump around the screen.
        const edge = status === "open" ? edge0 : nearestEdge(p.x, p.y, m.width, m.height, current.dock.edge);
        const anchor = anchorAt(edge, p.x, p.y, m.width, m.height, work) ?? (edge === edge0 ? from.dock.anchor : "auto");
        // On the edge it started on, the grabbed point stays under the pointer; on another, the notch's centre comes under it.
        const along = alongOf(edge, p.x, p.y) - span(edge, m.width, m.height) / 2 - (edge === edge0 ? rel.along : 0);
        current = { offset: Math.abs(along) < SNAP ? 0 : Math.round(along), y: from.y, dock: { edge, anchor } };
      }
      setLive(current);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => applyDisplay(current.offset, current.y, current.dock));
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!moved.current) return;
      holdOpen(false);
      updateSettings((cur) => ({ display: { ...cur.display, offset: current.offset, y: current.y }, dock: current.dock }));
      setLive(null);
      // The click right after releasing shouldn't open anything.
      setTimeout(() => (moved.current = false), 0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return { offset, y, dock, dragging: live !== null, onPointerDown, moved: () => moved.current };
}
