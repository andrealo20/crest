import { useEffect, type MouseEvent, type MouseEventHandler, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { CaretUp } from "@phosphor-icons/react";
import { t } from "../../../i18n";
import { taskbar } from "../../../platform/services";
import { updateSettings } from "../../../settings/store";
import { AppIcon } from "../../launcher/AppIcon";
import type { TrayIcon } from "../model";
import { panel, togglePanel, trayDrag } from "../panel";
import { dropSlot } from "../panelModel";
import { startTray, trayPictures, trayState } from "../tray";
import { demote, promote, shownSlot, splitTray } from "../trayModel";
import { holdBriefly } from "./hold";
import { Item, type ItemProps } from "./Item";

type Common = Pick<ItemProps, "name" | "label" | "failed" | "lifted" | "size" | "markAt" | "onEnter" | "onLeave">;

/** How far a press on an icon moves before it drags the icon, CSS px; less is still a click. */
const DRAG = 4;
/** The ways a press ends without a key. */
const PRESS_ENDS = ["pointerup", "pointercancel", "lostpointercapture"] as const;
/** Room between two buttons in a zone (gap-0.5), CSS px, which the drop marker fills. */
const BUTTON_GAP = 2;

// The press being followed (its end), and whether the last press dragged its icon: the click its release makes sends nothing.
let endPress: (() => void) | null = null;
let dragged = false;

/**
 * A press on a tray icon, on the bar or in the panel, followed until the pointer lets go: past DRAG it drags the icon (trayDrag),
 * which TrayDrop keeps on the bar or hides where it is let go. It ends on the release, a cancel, a lost capture (its button taken
 * away meanwhile) or Esc while dragging; `dragged` outlives it.
 */
function press(e: ReactPointerEvent<HTMLButtonElement>, icon: TrayIcon, from: "panel" | "bar") {
  if (e.button !== 0) return;
  endPress?.();
  const { pointerId, clientX, clientY } = e;
  const button = e.currentTarget;
  // The button gets every move and the release, wherever the pointer goes, and the window gets them from it.
  button.setPointerCapture(pointerId);
  dragged = false;
  const onMove = (m: PointerEvent) => {
    if (m.pointerId !== pointerId || (!dragged && Math.hypot(m.clientX - clientX, m.clientY - clientY) <= DRAG)) return;
    dragged = true;
    trayDrag.set({ id: icon.id, img: icon.img, x: m.clientX, y: m.clientY, from });
  };
  const onEnd = (m: PointerEvent) => m.pointerId === pointerId && end();
  // Taken on the way down, before the panel's own Esc, which then leaves the panel open.
  const onKey = (k: KeyboardEvent) => {
    if (k.key !== "Escape" || !dragged) return;
    k.preventDefault();
    end();
  };
  const end = () => {
    removeEventListener("pointermove", onMove);
    for (const type of PRESS_ENDS) removeEventListener(type, onEnd);
    removeEventListener("keydown", onKey, true);
    if (button.hasPointerCapture(pointerId)) button.releasePointerCapture(pointerId);
    endPress = null;
    trayDrag.set(null);
  };
  addEventListener("pointermove", onMove);
  for (const type of PRESS_ENDS) addEventListener(type, onEnd);
  addEventListener("keydown", onKey, true);
  endPress = end;
}

/**
 * What a tray icon does, on the bar and in the panel, as in Windows' tray: one left click, then the double click (the browser's
 * click, click, dblclick send left, nothing, double), and the right click, each with the box the icon is drawn in; a press that
 * moves drags it, and its release clicks nothing.
 */
export function trayButton(icon: TrayIcon, from: "panel" | "bar") {
  const send = (button: "left" | "right" | "double", e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    // The bar stays up for the menu or window the app may open, until Rust sees it in front (hold.ts).
    holdBriefly();
    // The program may be gone, or refuse; nothing changes then.
    taskbar.trayClick(icon.key, button, { x: r.x, y: r.y, w: r.width, h: r.height }).catch(() => {});
  };
  return {
    onClick: (e: MouseEvent<HTMLButtonElement>) => {
      // A key's click (no count) never ends a drag.
      if (e.detail > 1 || (e.detail > 0 && dragged)) return;
      send("left", e);
    },
    onDoubleClick: (e: MouseEvent<HTMLButtonElement>) => send("double", e),
    onContextMenu: (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      send("right", e);
    },
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => press(e, icon, from),
  };
}

/**
 * The notification area on the bar: each icon kept visible as a button of its own, then the ^ button, which opens the others in the
 * panel above the bar (TrayPanel). An icon dragged along the bar moves there, dragged onto ^ or into the panel it goes to the panel.
 */
export function Tray({
  visible,
  size,
  item,
  tile,
  more: moreRef,
  onMenu,
}: {
  visible: TrayIcon[];
  size: number;
  /** What every button has in common, by the key it is hovered under (TaskbarWindow's `item`). */
  item: (key: string, name: string) => Common;
  tile: () => ItemProps["tile"];
  /** The ^ button, where TrayDrop finds the end of the tray. */
  more: RefObject<HTMLButtonElement | null>;
  /** A right click on the ^ button, which has no menu of its own: the Crest menu over the pointer. */
  onMenu: MouseEventHandler<HTMLButtonElement>;
}) {
  useEffect(() => startTray(), []);
  const pictures = trayPictures.use();
  const open = panel.use();
  const toggle: MouseEventHandler<HTMLButtonElement> = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    togglePanel({ kind: "tray" }, { x: r.x, w: r.width });
  };
  const more = t("Ausgeblendete Symbole anzeigen");
  return (
    <>
      {visible.map((icon, i) => (
        <Item key={icon.key} {...item(`tray:${icon.key}`, icon.tip || t("Infobereich"))} tile={tile()} tray={i} {...trayButton(icon, "bar")}>
          <AppIcon src={icon.img === null ? null : pictures[icon.img]} size={size} />
        </Item>
      ))}
      <Item {...item("tray-more", more)} ref={moreRef} tile={tile()} expanded={open?.content.kind === "tray"} onClick={toggle} onContextMenu={onMenu}>
        <CaretUp size={size} weight="bold" />
      </Item>
    </>
  );
}

/** A point inside a box. */
const within = (r: DOMRect, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

/**
 * Where a tray icon dragged to (x, y) lands: kept on the bar at a slot among the icons kept there (`[data-tray]`), over them or ^,
 * with the box it goes in front of; hidden, from the bar onto ^ or into the panel; elsewhere null, which changes nothing.
 */
function dropAt(bar: HTMLElement | null, more: HTMLElement | null, d: { x: number; y: number; from: "panel" | "bar" }) {
  const box = document.querySelector("[data-tray-panel]")?.getBoundingClientRect();
  if (box && within(box, d.x, d.y)) return d.from === "bar" ? ({ hide: true } as const) : null;
  if (!bar || !more || d.y < bar.getBoundingClientRect().top) return null;
  const caret = more.getBoundingClientRect();
  if (d.from === "bar" && d.x >= caret.left && d.x <= caret.right) return { hide: true } as const;
  const slots = [...bar.querySelectorAll("[data-tray]")].map((el) => el.getBoundingClientRect());
  if (d.x < (slots[0] ?? caret).left || d.x > caret.right) return null;
  const slot = dropSlot(slots.map((r) => ({ x: r.x, w: r.width })), d.x);
  return { hide: false, slot, before: slots[slot] ?? caret } as const;
}

/**
 * A tray icon dragged (trayDrag): its picture under the pointer and, where it would be kept on the bar, a line in the gap it goes in.
 * Let go there it is kept there, onto ^ or into the panel from the bar it is hidden, anywhere else nothing changes: `trayShown` is
 * written once per drop. Nothing of it runs while no icon is dragged.
 */
export function TrayDrop({ bar, more, size }: { bar: RefObject<HTMLElement | null>; more: RefObject<HTMLElement | null>; size: number }) {
  const drag = trayDrag.use();
  const pictures = trayPictures.use();
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    // Taken on the way down, before the press ends the drag on the same release.
    const onUp = () => {
      const d = trayDrag.get();
      const at = d && dropAt(bar.current, more.current, d);
      if (!d || !at) return;
      updateSettings((s) => {
        const shown = s.taskbar.trayShown;
        const next = at.hide ? demote(shown, d.id) : promote(shown, d.id, shownSlot(shown, splitTray(trayState.get().icons, shown).visible, at.slot));
        return { taskbar: { ...s.taskbar, trayShown: next } };
      });
    };
    addEventListener("pointerup", onUp, true);
    return () => removeEventListener("pointerup", onUp, true);
  }, [dragging, bar, more]);
  if (!drag) return null;

  const at = dropAt(bar.current, more.current, drag);
  return (
    <>
      <span className="pointer-events-none fixed top-0 left-0 flex" style={{ transform: `translate(${drag.x - size / 2}px, ${drag.y - size / 2}px)` }}>
        <AppIcon src={drag.img === null ? null : pictures[drag.img]} size={size} />
      </span>
      {at && !at.hide && (
        <span
          className="pointer-events-none fixed top-0 left-0 w-0.5 rounded-full bg-accent"
          style={{ height: size, transform: `translate(${at.before.left - BUTTON_GAP}px, ${at.before.top + (at.before.height - size) / 2}px)` }}
        />
      )}
    </>
  );
}
