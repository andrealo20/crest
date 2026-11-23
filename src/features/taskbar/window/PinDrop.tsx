import { useLayoutEffect, useRef, type RefObject } from "react";
import { settings } from "../../../settings/store";
import { AppIcon } from "../../launcher/AppIcon";
import { FOLDER_REST, dropOnBar, folderKey, intoFolder, moveInFolder, nextName, normalizeFolders, pinOver } from "../folderModel";
import { pinDrop, pinSlots, type PinSlot } from "../model";
import { closePanel, fileDrag, pinDrag } from "../panel";
import { gridSlot } from "../panelModel";
import { beyond } from "../position";
import { FolderIcon } from "./AppsPanel";
import { barEdgeNow } from "./barEdge";
import { editPins } from "./BarMenu";
import { useRestOn } from "./DropTrash";
import { folderLabel } from "./FolderPanel";
import { panelLine } from "./Tray";

/** This bar's pinned places (`[data-pin]`, in DOM order: pinned apps and folders), with the bar's box; null when (x, y) is off the bar or past it on the screen's side. */
function slotsAt(bar: HTMLElement | null, x: number, y: number) {
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  if (beyond(barEdgeNow(), y, r) || x < r.left || x > r.right) return null;
  const shown = [...bar.querySelectorAll<HTMLElement>("[data-pin]")].map((el): PinSlot => {
    const b = el.getBoundingClientRect();
    return { id: el.dataset.pin!, x: b.left, w: b.width };
  });
  return { slots: pinSlots(shown), r };
}

/** Where a pin (or files, id null) dragged to (x, y) lands among this bar's pinned buttons: null off the bar, past it on the screen's side, on its own place or with no pinned button. */
export function placeAt(bar: HTMLElement | null, d: { id: string | null; x: number; y: number }, gap: number) {
  const on = slotsAt(bar, d.x, d.y);
  const at = on && pinDrop(on.slots, d.id, d.x, gap);
  return at && { ...at, top: on.r.top + on.r.height / 2 };
}

/** The place an app dragged to (x, y) is held over (pinOver), with its box, or null; never the folder it is dragged out of. */
function overAt(bar: HTMLElement | null, d: { id: string; x: number; y: number }, own: string | null) {
  const on = slotsAt(bar, d.x, d.y);
  if (!on) return null;
  const id = pinOver(on.slots, d.id, d.x);
  const slot = id && id !== own ? on.slots.find((s) => s.id === id) : undefined;
  return slot ? { ...slot, top: on.r.top, h: on.r.height } : null;
}

/** Where an app dragged out of its folder's panel lands back in it: the cell it goes before and the line there, null on its own place; undefined outside the panel. */
function panelAt(d: { x: number; y: number }, from: number) {
  const box = document.querySelector("[data-folder-panel]");
  const r = box?.getBoundingClientRect();
  if (!box || !r || d.x < r.left || d.x > r.right || d.y < r.top || d.y > r.bottom) return undefined;
  const cells = [...box.querySelectorAll("[data-app-cell]")];
  const rtl = document.documentElement.dir === "rtl";
  const slot = gridSlot(cells.map((el) => el.getBoundingClientRect()).map((c) => ({ x: c.x, y: c.y, w: c.width, h: c.height })), d.x, d.y, rtl);
  return slot === from || slot === from + 1 ? null : { slot, line: panelLine(cells, slot, rtl) };
}

/**
 * A pinned app or a folder dragged along the bar (pinDrag): its icon under the pointer and, where it would land, a line in the gap it
 * goes in. Held still FOLDER_REST on the middle half of another app or a folder, the line gives way to a ring round it: let go then and
 * the two make a folder there, or the app goes into that folder. Let go elsewhere on the bar and it moves there, out of its folder for
 * an app dragged from a folder's panel, a folder with all its apps; inside that panel it moves among the folder's apps. Off the bar, on
 * its own place or after Esc nothing changes, and each drop is written once. Files dragged over the apps (fileDrag) get the line only.
 * Nothing of it runs while nothing is dragged.
 */
export function PinDrop({ bar, size, gap, icons }: { bar: RefObject<HTMLElement | null>; size: number; gap: number; icons: Record<string, string | null> }) {
  const drag = pinDrag.use();
  const files = fileDrag.use();
  const { pinned, folders: saved } = settings.use().taskbar;
  const folders = normalizeFolders(saved, pinned);
  const home = drag && folders.find((f) => f.apps.includes(drag.id));
  const over = drag && overAt(bar.current, drag, drag.from === "folder" && home ? folderKey(home.id) : null);
  const ring = useRestOn(over?.id ?? null, FOLDER_REST);
  // What a release now does: read by the release, which comes between two renders.
  const ringOn = useRef<string | null>(null);
  ringOn.current = ring && over ? over.id : null;
  const dragging = drag !== null;
  // As ItemDrop's: a layout effect, so a release right after the drag starts is never missed.
  useLayoutEffect(() => {
    if (!dragging) return;
    const onUp = (m: PointerEvent) => {
      const d = pinDrag.get();
      if (!d || d.pointerId !== m.pointerId) return;
      const target = ringOn.current;
      if (d.from === "folder") {
        const apps = normalizeFolders(settings.get().taskbar.folders, settings.get().taskbar.pinned).find((f) => f.apps.includes(d.id))?.apps ?? [];
        const inside = panelAt(d, apps.indexOf(d.id));
        if (inside) editPins((p) => moveInFolder(p, d.id, inside.slot));
        if (inside !== undefined) return;
      }
      const at = target ? null : placeAt(bar.current, d, gap);
      if (!target && !at) return;
      editPins((p) => (target ? intoFolder(p, d.id, target, crypto.randomUUID(), nextName(p.folders, folderLabel)) : dropOnBar(p, d.id, at!.before)));
      // Out of the folder whose panel it came from: the panel has done its part.
      if (d.from === "folder") closePanel();
    };
    addEventListener("pointerup", onUp, true);
    return () => removeEventListener("pointerup", onUp, true);
  }, [dragging, bar, gap]);
  if (!drag) {
    const at = files && placeAt(bar.current, { id: null, ...files }, gap);
    return at ? line(at, size) : null;
  }

  const inside = drag.from === "folder" && home ? panelAt(drag, home.apps.indexOf(drag.id)) : undefined;
  const at = inside === undefined && !ring ? placeAt(bar.current, drag, gap) : null;
  const ghost = folders.find((f) => folderKey(f.id) === drag.id);
  // Round the icon's room, as tall as a cell of the panel.
  const ringH = over && Math.min(over.h, size + 16);
  return (
    <>
      {/* As ItemDrop's ghost, lifted on a tonal disc under Material. */}
      <span className="pointer-events-none fixed top-0 left-0 flex material:z-10 material:-m-1.5 material:p-1.5 material:rounded-full material:bg-secondary-container material:shadow-level4" style={{ transform: `translate(${drag.x - size / 2}px, ${drag.y - size / 2}px)` }}>
        {ghost ? <FolderIcon icons={ghost.apps.map((a) => icons[a])} size={size} /> : <AppIcon src={icons[drag.id]} size={size} />}
      </span>
      {at && line(at, size)}
      {inside?.line && (
        // 2 px wide, centred on the cell's edge, as TrayDrop's in the tray panel.
        <span className="pointer-events-none fixed top-0 left-0 w-0.5 rounded-full bg-accent material:bg-primary" style={{ height: inside.line.h, transform: `translate(${inside.line.x - 1}px, ${inside.line.y}px)` }} />
      )}
      {ring && over && ringH && (
        <span className="pointer-events-none fixed top-0 left-0 rounded-[10px] ring-2 ring-accent material:rounded-full material:ring-primary" style={{ width: over.w, height: ringH, transform: `translate(${over.x}px, ${over.top + (over.h - ringH) / 2}px)` }} />
      )}
    </>
  );
}

/** ItemDrop's line, in the gap a pin or the files go in. */
const line = (at: { line: number; top: number }, size: number) => (
  <span className="pointer-events-none fixed top-0 left-0 w-0.5 rounded-full bg-accent material:bg-primary" style={{ height: size, transform: `translate(${at.line}px, ${at.top - size / 2}px)` }} />
);
