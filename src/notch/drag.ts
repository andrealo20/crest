import { useRef, useState } from "react";
import { isNative } from "../platform/native";
import { display } from "../platform/services";
import { settings, updateSettings } from "../settings/store";
import { effectiveIdleStyle } from "../features/window/store";
import { snapCapsule, windowYFor } from "./capsule";
import { focusMode } from "./focus";
import { monitorMetrics, reloadMonitor } from "./monitor";
import { holdOpen, type NotchStatus } from "./useNotchState";

/** Below this distance it's a click, not a drag. */
const THRESHOLD = 6;
/** The notch snaps to the center when close to it. */
const SNAP = 24;

/** The window's top for the capsule top `y` (display.y unless given) on the notch's monitor; always finite, since Rust rejects NaN. */
export function windowY(y = settings.get().display.y): number {
  const s = settings.get(), m = monitorMetrics();
  const style = focusMode.get() && s.display.focusStyle === "line" ? "line" : effectiveIdleStyle(s.display.idleStyle);
  const top = windowYFor(style, y, m.height, m.workTop);
  return Number.isFinite(top) ? top : 0;
}

/** Sends display settings to Rust, optionally with an offset and a capsule top `y` that aren't saved yet (Rust gets the window's top from `windowY`). */
export function applyDisplay(offset = settings.get().display.offset, y?: number) {
  const s = settings.get();
  const b = s.behavior;
  display.apply({ monitor: s.display.monitor, offset, y: windowY(y), gaming: s.gaming.mode !== "off", rules: { ...b.rules, apps: b.apps }, zoom: b.scale / 100 });
}

/** The area the capsule is dragged in: the monitor, in the browser the viewport with DesktopMock's 48 px taskbar. */
function dragArea() {
  if (isNative) return monitorMetrics();
  return { width: window.innerWidth, height: window.innerHeight, workTop: 0, workHeight: window.innerHeight - 48 };
}

/*
 * Move the notch sideways, the capsule anywhere: grab it anywhere when closed, by the
 * header when open. Natively the window itself moves (display.rs, clamped to the
 * monitor), in the browser only the notch inside the window. Saved on release.
 * `size` is the closed shape, which the capsule snaps with.
 */
export function useDragToMove(status: NotchStatus, size: { w: number; h: number }) {
  const saved = settings.use().display;
  const [live, setLive] = useState<{ offset: number; y: number } | null>(null);
  const moved = useRef(false);
  const offset = live?.offset ?? saved.offset;
  const y = live?.y ?? saved.y;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    if (target.closest("button, input, textarea, a, [role=slider], [data-no-drag]")) return;
    // When open only via the header, otherwise lists and sliders would drag too.
    if (status === "open" && !target.closest("[data-drag-handle]")) return;

    const capsule = effectiveIdleStyle(saved.idleStyle) === "capsule";
    if (capsule) reloadMonitor();
    const { pointerId: id, screenX: x, screenY: sy } = e;
    const from = { offset, y };
    let current = from;
    let frame = 0;
    moved.current = false;

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const dx = ev.screenX - x, dy = capsule ? ev.screenY - sy : 0;
      if (!moved.current && Math.max(Math.abs(dx), Math.abs(dy)) < THRESHOLD) return;
      if (!moved.current) {
        moved.current = true;
        holdOpen(true);
      }
      if (capsule) {
        const m = dragArea(), left = m.width / 2 - size.w / 2;
        const s = snapCapsule(left + from.offset + dx, from.y + dy, size.w, size.h, m.width, m.height, { top: m.workTop, height: m.workHeight });
        current = { offset: Math.round(s.x - left), y: Math.round(s.y) };
      } else current = { offset: Math.abs(from.offset + dx) < SNAP ? 0 : Math.round(from.offset + dx), y: from.y };
      setLive(current);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => applyDisplay(current.offset, current.y));
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!moved.current) return;
      holdOpen(false);
      updateSettings((cur) => ({ display: { ...cur.display, offset: current.offset, y: current.y } }));
      setLive(null);
      // The click right after releasing shouldn't open anything.
      setTimeout(() => (moved.current = false), 0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return { offset, y, dragging: live !== null, onPointerDown, moved: () => moved.current };
}
