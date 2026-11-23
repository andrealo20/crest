import { useLayoutEffect, useRef, type RefObject } from "react";
import { partInfo } from "../../../notch/row/partInfo";
import { settings } from "../../../settings/store";
import { CrestMark } from "../../../ui/CrestMark";
import { NetGlyph } from "../../../ui/glyphs";
import { dropPlace, moveBefore, type BarEdge, type BarItem, type DropSlot, type Zone, type ZoneBox } from "../model";
import { itemDrag } from "../panel";
import { setTaskbar } from "../store";
import { toolInfo } from "../toolInfo";
import { isSys, isTool, isWidget, removeWidget, sysOf, toolOf, trashable } from "../widgets";
import { beyond, inBox, trashBox, type Box } from "../position";
import { barEdgeNow, useBarEdge } from "./barEdge";
import { DropTrash, useTrashArmed } from "./DropTrash";
import { SYS_INFO } from "./SysItems";

const ZONES: Zone[] = ["left", "center", "right"];

/** An item's span on the bar, its buttons' boxes together; null for one that draws nothing (Stato without a glyph, a widget the fit hid). */
function spanOf(span: Element): { x: number; w: number } | null {
  const boxes = [...span.children].map((c) => c.getBoundingClientRect()).filter((b) => b.width > 0);
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.left));
  return { x, w: Math.max(...boxes.map((b) => b.right)) - x };
}

/**
 * Where an item dragged to (x, y) lands among the bar's items (`[data-item]` spans, each as wide as its buttons together, in DOM
 * order) and zones (`[data-zone]`, none on the capsule): null off the bar, past it on the screen's side or on the item's own place.
 */
function placeAt(bar: HTMLElement | null, d: { id: BarItem; x: number; y: number }, unit: number, gap: number) {
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  if (beyond(barEdgeNow(), d.y, r) || d.x < r.left || d.x > r.right) return null;
  const saved = settings.get().taskbar.zones;
  const items = [...bar.querySelectorAll<HTMLElement>("[data-item]")].flatMap((span): DropSlot[] => {
    const id = span.dataset.item as BarItem;
    const zone = ZONES.find((z) => saved[z].includes(id));
    // An item that draws nothing has no place to go before.
    const at = spanOf(span);
    return zone && at ? [{ id, zone, ...at }] : [];
  });
  const zones = [...bar.querySelectorAll<HTMLElement>("[data-zone]")].map((el): ZoneBox => {
    const b = el.getBoundingClientRect();
    return { zone: el.dataset.zone as Zone, x: b.left, w: b.width };
  });
  const at = dropPlace(d.id, items, zones.length ? zones : null, d.x, unit, gap);
  return at && { ...at, top: r.top + r.height / 2 };
}

/** The trash over the dragged item's own place (trashBox), for an item the trash takes; null for any other, or while it draws nothing. */
function trashAt(bar: HTMLElement | null, id: BarItem, edge: BarEdge, off: number): Box | null {
  const span = trashable(id) ? bar?.querySelector(`[data-item="${CSS.escape(id)}"]`) : null;
  const at = span && spanOf(span);
  return at ? trashBox(edge, at, off, window.innerWidth, window.innerHeight) : null;
}

/** What the ghost shows: the widget's, the tool's or the Windows button's icon, Stato's Wi-Fi glyph, Crest's mark. */
function Ghost({ id, size }: { id: BarItem; size: number }) {
  if (id === "status") return <NetGlyph glyph="wifi-3" size={size} />;
  if (id === "crest") return <CrestMark size={size} />;
  const I = isWidget(id) ? partInfo[id].icon : isTool(id) ? toolInfo[toolOf(id)]?.icon : isSys(id) ? SYS_INFO[sysOf(id)].icon : undefined;
  return I ? <I size={size} weight="regular" /> : null;
}

/**
 * A widget, a tool button, a Windows button, Stato or the Crest button dragged along the bar (itemDrag): its icon under the pointer, where it would
 * land a line in the gap it goes in, and the trash past the bar over its own place (`off` px from the window's edge on the bar's
 * side, as the menus). Let go on the line it moves there in the saved zones, written once. Let go on the trash once it is armed
 * (the pointer has rested on it, useTrashArmed) and it leaves the bar, as with Remove in Settings > Taskbar > Items. Anywhere else,
 * on the trash before it is armed, on its own place or after Esc nothing changes. Nothing is measured while nothing is dragged.
 */
export function ItemDrop({ bar, size, gap, off }: { bar: RefObject<HTMLElement | null>; size: number; gap: number; off: number }) {
  const drag = itemDrag.use();
  const edge = useBarEdge();
  const dragging = drag !== null;
  // Measured at each move, as the line is: the item's own place does not move while it is dragged.
  const trash = drag && trashAt(bar.current, drag.id, edge, off);
  const armed = useTrashArmed(!!drag && !!trash && inBox(trash, drag.x, drag.y));
  // The trash as drawn, for the release: one not armed yet takes nothing.
  const armedTrash = useRef<Box | null>(null);
  armedTrash.current = armed ? trash : null;
  // A layout effect, so a release right after the drag starts is never missed; taken on the way down, before the press ends the drag.
  useLayoutEffect(() => {
    if (!dragging) return;
    const onUp = (m: PointerEvent) => {
      const d = itemDrag.get();
      // Another finger's release is not the drag's.
      if (!d || d.pointerId !== m.pointerId) return;
      // Still on it: a move off it may not have been drawn yet.
      const box = armedTrash.current, id = d.id;
      if (box && inBox(box, d.x, d.y) && trashable(id)) return setTaskbar((cur) => ({ zones: removeWidget(cur.zones, id) }));
      const at = placeAt(bar.current, d, size + 16, gap);
      if (!at) return;
      // The page and the release run in one task, so these are the saved zones of this moment; an unchanged move writes nothing.
      const cur = settings.get().taskbar.zones, next = moveBefore(cur, d.id, at.zone, at.before);
      if (next !== cur) setTaskbar({ zones: next });
    };
    addEventListener("pointerup", onUp, true);
    return () => removeEventListener("pointerup", onUp, true);
  }, [dragging, bar, size, gap]);

  const at = drag && placeAt(bar.current, drag, size + 16, gap);
  return (
    <>
      {/* Before the ghost, which Crest's style lifts over it by coming after; outside the drag's own return, so it can fade out. */}
      <DropTrash shown={!!trash} armed={armed} edge={edge} className="fixed" style={trash ? { left: trash.x, top: trash.y } : undefined} />
      {drag && (
        // Under Material lifted on a tonal disc at level 4, as a dragged row is, and over the line; as far out as it pads in, so the icon stays centred.
        <span className="pointer-events-none fixed top-0 left-0 flex text-label material:z-10 material:-m-1.5 material:p-1.5 material:rounded-full material:bg-secondary-container material:text-on-secondary-container material:shadow-level4" style={{ transform: `translate(${drag.x - size / 2}px, ${drag.y - size / 2}px)` }}>
          <Ghost id={drag.id} size={size} />
        </span>
      )}
      {at && (
        // 2 px wide, as the tray's line (TrayDrop).
        <span className="pointer-events-none fixed top-0 left-0 w-0.5 rounded-full bg-accent material:bg-primary" style={{ height: size, transform: `translate(${at.line}px, ${at.top - size / 2}px)` }} />
      )}
    </>
  );
}
