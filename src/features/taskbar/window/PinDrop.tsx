import { useLayoutEffect, type RefObject } from "react";
import { settings } from "../../../settings/store";
import { AppIcon } from "../../launcher/AppIcon";
import { movePinned, pinDrop, type PinSlot } from "../model";
import { fileDrag, pinDrag } from "../panel";
import { beyond } from "../position";
import { setTaskbar } from "../store";
import { barEdgeNow } from "./barEdge";

/** Where a pin (or files, id null) dragged to (x, y) lands among this bar's pinned buttons (`[data-pin]`, in DOM order): null off the bar, past it on the screen's side, on its own place or with no pinned button. */
export function placeAt(bar: HTMLElement | null, d: { id: string | null; x: number; y: number }, gap: number) {
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  if (beyond(barEdgeNow(), d.y, r) || d.x < r.left || d.x > r.right) return null;
  const slots = [...bar.querySelectorAll<HTMLElement>("[data-pin]")].map((el): PinSlot => {
    const b = el.getBoundingClientRect();
    return { id: el.dataset.pin!, x: b.left, w: b.width };
  });
  const at = pinDrop(slots, d.id, d.x, gap);
  return at && { ...at, top: r.top + r.height / 2 };
}

/**
 * A pinned app dragged along the bar (pinDrag): its icon under the pointer and, where it would land, a line in the gap it goes in. Let
 * go there it moves there in the pinned apps, written once; off the bar, on its own place or after Esc nothing changes. Files dragged
 * over the apps (fileDrag) get the line only. Nothing of it runs while nothing is dragged.
 */
export function PinDrop({ bar, size, gap, icons }: { bar: RefObject<HTMLElement | null>; size: number; gap: number; icons: Record<string, string | null> }) {
  const drag = pinDrag.use();
  const files = fileDrag.use();
  const dragging = drag !== null;
  // As ItemDrop's: a layout effect, so a release right after the drag starts is never missed.
  useLayoutEffect(() => {
    if (!dragging) return;
    const onUp = (m: PointerEvent) => {
      const d = pinDrag.get();
      const at = d && d.pointerId === m.pointerId && placeAt(bar.current, d, gap);
      const cur = settings.get().taskbar.pinned;
      if (!d || !at || !cur) return;
      const next = movePinned(cur, d.id, at.before);
      if (next !== cur) setTaskbar({ pinned: next });
    };
    addEventListener("pointerup", onUp, true);
    return () => removeEventListener("pointerup", onUp, true);
  }, [dragging, bar, gap]);
  if (!drag) {
    const at = files && placeAt(bar.current, { id: null, ...files }, gap);
    return at ? line(at, size) : null;
  }

  const at = placeAt(bar.current, drag, gap);
  return (
    <>
      {/* As ItemDrop's ghost, lifted on a tonal disc under Material. */}
      <span className="pointer-events-none fixed top-0 left-0 flex material:z-10 material:-m-1.5 material:p-1.5 material:rounded-full material:bg-secondary-container material:shadow-level4" style={{ transform: `translate(${drag.x - size / 2}px, ${drag.y - size / 2}px)` }}>
        <AppIcon src={icons[drag.id]} size={size} />
      </span>
      {at && line(at, size)}
    </>
  );
}

/** ItemDrop's line, in the gap a pin or the files go in. */
const line = (at: { line: number; top: number }, size: number) => (
  <span className="pointer-events-none fixed top-0 left-0 w-0.5 rounded-full bg-accent material:bg-primary" style={{ height: size, transform: `translate(${at.line}px, ${at.top - size / 2}px)` }} />
);
