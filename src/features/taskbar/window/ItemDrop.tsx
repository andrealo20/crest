import { useLayoutEffect, type RefObject } from "react";
import { partInfo } from "../../../notch/row/partInfo";
import { settings } from "../../../settings/store";
import { NetGlyph } from "../../../ui/glyphs";
import { dropPlace, moveBefore, type BarItem, type DropSlot, type Zone, type ZoneBox } from "../model";
import { itemDrag } from "../panel";
import { setTaskbar } from "../store";
import { toolInfo } from "../toolInfo";
import { isTool, isWidget, toolOf } from "../widgets";

const ZONES: Zone[] = ["left", "center", "right"];

/**
 * Where an item dragged to (x, y) lands among the bar's items (`[data-item]` spans, each as wide as its buttons together, in DOM
 * order) and zones (`[data-zone]`, none on the capsule): null off the bar, above its top edge or on the item's own place.
 */
function placeAt(bar: HTMLElement | null, d: { id: BarItem; x: number; y: number }, unit: number, gap: number) {
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  if (d.y < r.top || d.x < r.left || d.x > r.right) return null;
  const saved = settings.get().taskbar.zones;
  const items = [...bar.querySelectorAll<HTMLElement>("[data-item]")].flatMap((span): DropSlot[] => {
    const id = span.dataset.item as BarItem;
    const zone = ZONES.find((z) => saved[z].includes(id));
    // An item that draws nothing (Stato without a glyph, a widget the fit hid) has no place to go before.
    const boxes = [...span.children].map((c) => c.getBoundingClientRect()).filter((b) => b.width > 0);
    if (!zone || !boxes.length) return [];
    const x = Math.min(...boxes.map((b) => b.left));
    return [{ id, zone, x, w: Math.max(...boxes.map((b) => b.right)) - x }];
  });
  const zones = [...bar.querySelectorAll<HTMLElement>("[data-zone]")].map((el): ZoneBox => {
    const b = el.getBoundingClientRect();
    return { zone: el.dataset.zone as Zone, x: b.left, w: b.width };
  });
  const at = dropPlace(d.id, items, zones.length ? zones : null, d.x, unit, gap);
  return at && { ...at, top: r.top + r.height / 2 };
}

/** What the ghost shows: the widget's or the tool's icon, Stato's Wi-Fi glyph. */
function Ghost({ id, size }: { id: BarItem; size: number }) {
  if (id === "status") return <NetGlyph glyph="wifi-3" size={size} />;
  const I = isWidget(id) ? partInfo[id].icon : isTool(id) ? toolInfo[toolOf(id)]?.icon : undefined;
  return I ? <I size={size} weight="regular" /> : null;
}

/**
 * A widget, a tool button or Stato dragged along the bar (itemDrag): its icon under the pointer and, where it would land, a line in
 * the gap it goes in. Let go there it moves there in the saved zones, written once; off the bar, on its own place or after Esc
 * nothing changes, and it is never taken off the bar. Nothing of it runs while nothing is dragged.
 */
export function ItemDrop({ bar, size, gap }: { bar: RefObject<HTMLElement | null>; size: number; gap: number }) {
  const drag = itemDrag.use();
  const dragging = drag !== null;
  // A layout effect, so a release right after the drag starts is never missed; taken on the way down, before the press ends the drag.
  useLayoutEffect(() => {
    if (!dragging) return;
    const onUp = (m: PointerEvent) => {
      const d = itemDrag.get();
      // Another finger's release is not the drag's.
      const at = d && d.pointerId === m.pointerId && placeAt(bar.current, d, size + 16, gap);
      if (!d || !at) return;
      // The page and the release run in one task, so these are the saved zones of this moment; an unchanged move writes nothing.
      const cur = settings.get().taskbar.zones, next = moveBefore(cur, d.id, at.zone, at.before);
      if (next !== cur) setTaskbar({ zones: next });
    };
    addEventListener("pointerup", onUp, true);
    return () => removeEventListener("pointerup", onUp, true);
  }, [dragging, bar, size, gap]);
  if (!drag) return null;

  const at = placeAt(bar.current, drag, size + 16, gap);
  return (
    <>
      {/* Under Material lifted on a tonal disc at level 4, as a dragged row is, and over the line; as far out as it pads in, so the icon stays centred. */}
      <span className="pointer-events-none fixed top-0 left-0 flex text-label material:z-10 material:-m-1.5 material:p-1.5 material:rounded-full material:bg-secondary-container material:text-on-secondary-container material:shadow-level4" style={{ transform: `translate(${drag.x - size / 2}px, ${drag.y - size / 2}px)` }}>
        <Ghost id={drag.id} size={size} />
      </span>
      {at && (
        // 2 px wide, as the tray's line (TrayDrop).
        <span className="pointer-events-none fixed top-0 left-0 w-0.5 rounded-full bg-accent material:bg-primary" style={{ height: size, transform: `translate(${at.line}px, ${at.top - size / 2}px)` }} />
      )}
    </>
  );
}
