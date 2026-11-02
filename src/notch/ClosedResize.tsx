import { useEffect, useRef } from "react";
import { Check } from "@phosphor-icons/react";
import { createStore } from "../lib/store";
import { settings, updateSettings } from "../settings/store";
import { t } from "../i18n";
import { defaultClosed, resizeClosed, type ClosedGrip, type ClosedSize } from "./collapsed";
import { across, deltaFromScreen, uprightCss, type Edge } from "./edge";

/**
 * Resize mode of the closed notch (Settings, Display, Adjust on the notch): grips on its two ends and its far side, its size and a
 * Done button just past it. While it is on, the notch neither opens nor moves (Notch.tsx); Done or Esc ends it.
 */
export const closedEdit = createStore(false);
/** The sizes while a grip is dragged, drawn at once; saved on release like the sliders' values. */
export const closedLive = createStore<Partial<ClosedSize> | null>(null);

const GRIPS: { grip: ClosedGrip; className: string; bar: string }[] = [
  { grip: "start", className: "inset-y-0 -left-2 w-4", bar: "h-3/5 min-h-2 w-1" },
  { grip: "end", className: "inset-y-0 -right-2 w-4", bar: "h-3/5 min-h-2 w-1" },
  { grip: "depth", className: "inset-x-3 -bottom-2 h-4", bar: "w-1/3 min-w-3 h-1" },
];

/** The grips, inside the closed shape; `widest` is the monitor along the edge, the most a width can take. */
export function ClosedResize({ style, edge, widest }: { style: "notch" | "capsule" | "line"; edge: Edge; widest: number }) {
  const save = (patch: Partial<ClosedSize>) => updateSettings((cur) => ({ closedSize: { ...cur.closedSize, ...patch } }));

  // Ends a drag in progress; also on unmount, so the live size can't stick.
  const end = useRef<(() => void) | null>(null);
  useEffect(() => () => end.current?.(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closedEdit.set(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onPointerDown = (grip: ClosedGrip) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    end.current?.();
    const el = e.currentTarget, pointer = e.pointerId, start = settings.get().closedSize, x0 = e.clientX, y0 = e.clientY;
    el.setPointerCapture(pointer);
    let current: Partial<ClosedSize> | null = null;
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      // The notch on the bottom or a side edge is drawn turned: the drag is taken in its own frame (along its edge, away from it).
      const d = deltaFromScreen(edge, ev.clientX - x0, ev.clientY - y0);
      current = resizeClosed(start, style, grip, d.x, d.y, widest);
      closedLive.set(current);
    };
    const onUp = (ev: PointerEvent) => ev.pointerId === pointer && end.current?.();
    end.current = () => {
      end.current = null;
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("lostpointercapture", onUp);
      if (current) save(current);
      closedLive.set(null);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("lostpointercapture", onUp);
  };

  // On a side edge the frame is turned a quarter, so the ends resize up and down on the screen.
  const sideways = across(edge);
  return (
    <>
      {GRIPS.map((g) => (
        <div
          key={g.grip}
          data-no-drag
          title={t("Ziehen ändert die Größe, Doppelklick setzt sie zurück")}
          className={`absolute z-10 flex items-center justify-center ${g.className}`}
          style={{ cursor: (g.grip === "depth") !== sideways ? "ns-resize" : "ew-resize" }}
          onPointerDown={onPointerDown(g.grip)}
          onDoubleClick={() => save(defaultClosed(style, g.grip))}
        >
          <span className={`rounded-full bg-white/80 ${g.bar}`} />
        </div>
      ))}
    </>
  );
}

/**
 * The size and the Done button, just past the shape: outside it, which clips what leaves it, in the hit zone that the resize mode
 * lengthens for them (Notch.tsx). Upright on every edge.
 */
export function ClosedResizeBar({ style, edge }: { style: "notch" | "capsule" | "line"; edge: Edge }) {
  const now = { ...settings.use().closedSize, ...closedLive.use() };
  const [w, h] = style === "line" ? [now.lineLength, now.lineThickness] : style === "capsule" ? [now.capsuleWidth, now.capsuleHeight] : [now.notchWidth, now.notchHeight];
  return (
    <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 justify-center">
      <div className="flex items-center gap-2 whitespace-nowrap" style={{ transform: uprightCss(edge) }}>
        <span className="tabular rounded-full bg-black/80 px-2 py-0.5 text-caption text-white">{`${w} × ${h} px`}</span>
        <button data-no-drag className="pressable flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-caption font-medium text-black" onClick={() => closedEdit.set(false)}>
          <Check size={11} weight="bold" />
          {t("Fertig")}
        </button>
      </div>
    </div>
  );
}
