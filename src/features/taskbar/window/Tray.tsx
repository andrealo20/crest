import { useEffect, type MouseEvent, type MouseEventHandler, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { CaretDown, CaretUp } from "../../../ui/iconset";
import { t } from "../../../i18n";
import { taskbar } from "../../../platform/services";
import { updateSettings } from "../../../settings/store";
import { AppIcon } from "../../launcher/AppIcon";
import { trayIcon, type TrayIcon } from "../model";
import { panel, panelHeld, togglePanel, trayDrag } from "../panel";
import { dropSlot, gridSlot } from "../panelModel";
import { followWhite, startTray, trayFolded, trayPictures, trayState, trayWhite } from "../tray";
import { demote, placeHidden, promote, shownSlot, splitTray } from "../trayModel";
import { beyond } from "../position";
import { barEdgeNow, useBarEdge } from "./barEdge";
import { holdBriefly } from "./hold";
import { Item, type ItemProps } from "./Item";
import { startPress, pressDragged } from "./press";

/** What every bar button has in common (TaskbarWindow's `item`). */
export type Common = Pick<ItemProps, "name" | "label" | "failed" | "hover" | "hoverLabel" | "size" | "markAt" | "plus" | "onEnter" | "onLeave">;

/** How far a press on an icon moves before it drags the icon, CSS px; less is still a click. */
const DRAG = 4;

/** A press on a tray icon, on the bar or in the panel: past DRAG it drags the icon (trayDrag), which TrayDrop keeps on the bar or hides where it is let go. */
function press(e: ReactPointerEvent<HTMLButtonElement>, icon: TrayIcon, from: "panel" | "bar") {
  startPress(e, { threshold: DRAG, onDrag: (x, y) => trayDrag.set({ id: icon.id, img: icon.img, x, y, from }), onEnd: () => trayDrag.set(null) });
}

/**
 * A tray icon's picture. A plain white glyph, drawn by its app for Windows' dark taskbar, takes the ink of what is under it instead,
 * the text colour of the bar or the panel, so a light theme does not swallow it (#93); its greys stay as light as they were.
 */
export function TrayPicture({ img, size }: { img: string | null; size: number }) {
  const pictures = trayPictures.use();
  const white = trayWhite.use();
  const src = img === null ? null : pictures[img];
  if (!src || img === null || !white[img]) return <AppIcon src={src} size={size} />;
  return <span aria-hidden className="shrink-0 bg-label" style={{ width: size, height: size, maskImage: `url("${src}")`, maskMode: "luminance", maskSize: "100% 100%" }} />;
}

/** How long the pointer rests on a tray icon before its app hears it, as Windows' tray waits before a popup, ms. */
const TRAY_REST = 400;
/** The icon whose app heard the pointer rest on it, with the box it was told, and the rest still to run out. */
const rest: { timer?: number; sent: { key: string; rect: { x: number; y: number; w: number; h: number } } | null } = { sent: null };

/** The pointer onto a tray icon: after TRAY_REST its app hears it, so an app that draws its own popup shows it. */
export function trayEnter(icon: TrayIcon, el: HTMLElement): void {
  window.clearTimeout(rest.timer);
  rest.timer = window.setTimeout(() => {
    const r = el.getBoundingClientRect();
    rest.sent = { key: icon.key, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
    taskbar.trayClick(icon.key, "hover", rest.sent.rect).catch(() => {});
  }, TRAY_REST);
}

/** The pointer off it: a rest not run out is dropped, and an app that heard one hears the leave. */
export function trayLeave(): void {
  window.clearTimeout(rest.timer);
  if (rest.sent) taskbar.trayClick(rest.sent.key, "leave", rest.sent.rect).catch(() => {});
  rest.sent = null;
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
      if (e.detail > 1 || (e.detail > 0 && pressDragged())) return;
      send("left", e);
    },
    onDoubleClick: (e: MouseEvent<HTMLButtonElement>) => send("double", e),
    onContextMenu: (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      // The app's menu takes the focus, and the panel stays open under it (TrayPanel ends the hold).
      if (from === "panel") panelHeld.set(true);
      send("right", e);
    },
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => press(e, icon, from),
  };
}

/**
 * The notification area on the bar: each icon kept visible as a button of its own, then the ^ button, which opens the others in the
 * panel above the bar (TrayPanel). An icon dragged along the bar moves there, dragged onto ^ or into the panel it goes to the panel,
 * and dragged inside the panel it moves there.
 */
export function Tray({
  visible,
  size,
  item,
  tile,
  tiles,
  more: moreRef,
  onMenu,
}: {
  visible: TrayIcon[];
  size: number;
  /** What every button has in common, by the key it is hovered under (TaskbarWindow's `item`). */
  item: (key: string, name: string) => Common;
  /** Each tile by its index, ^ last (TaskbarWindow reserves their places). */
  tile: (i: number) => ItemProps["tile"];
  /** The Tiles shape, whose tiles stay as wide as the apps' (size + 16). */
  tiles: boolean;
  /** The ^ button, where TrayDrop finds the end of the tray. */
  more: RefObject<HTMLButtonElement | null>;
  /** A right click on the ^ button, which has no menu of its own: the Crest menu over the pointer. */
  onMenu: MouseEventHandler<HTMLButtonElement>;
}) {
  useEffect(() => startTray(), []);
  useEffect(() => followWhite(), []);
  useEffect(() => trayLeave, []);
  const open = panel.use();
  const toggle: MouseEventHandler<HTMLButtonElement> = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    togglePanel({ kind: "tray" }, { x: r.x, w: r.width });
  };
  const more = t("Ausgeblendete Symbole anzeigen");
  const glyph = trayIcon(size);
  const edge = useBarEdge();
  const slot = tiles ? undefined : glyph + 16;
  return (
    <>
      {visible.map((icon, i) => {
        const common = item(`tray:${icon.key}`, icon.tip || t("Infobereich"));
        return (
          <Item
            key={icon.key}
            {...common}
            onEnter={(e) => {
              common.onEnter(e);
              trayEnter(icon, e.currentTarget);
            }}
            onLeave={() => {
              common.onLeave();
              trayLeave();
            }}
            tile={tile(i)}
            tray={i}
            width={slot}
            {...trayButton(icon, "bar")}
          >
            <TrayPicture img={icon.img} size={glyph} />
          </Item>
        );
      })}
      <Item {...item("tray-more", more)} ref={moreRef} tile={tile(visible.length)} expanded={open?.content.kind === "tray"} width={slot} onClick={toggle} onContextMenu={onMenu}>
        {edge === "top" ? <CaretDown size={glyph} weight="regular" /> : <CaretUp size={glyph} weight="regular" />}
      </Item>
    </>
  );
}

/** A point inside a box. */
const within = (r: DOMRect, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

/**
 * The line where an icon let go in the panel goes: at the leading edge of the slot's cell, past the last at the trailing edge of the last
 * (a row runs from the right in a right-to-left language), as tall as the cell's icon, its first child but Material's pill in an app's
 * cell (`data-front-pill`); none in an empty panel. A folder's panel draws its line so too (PinDrop).
 */
export function panelLine(cells: Element[], slot: number, rtl: boolean) {
  const cell = cells[slot] ?? cells[cells.length - 1];
  if (!cell) return null;
  const r = cell.getBoundingClientRect();
  const icon = (cell.querySelector(":scope > :not([data-front-pill])") ?? cell).getBoundingClientRect();
  return { x: slot < cells.length !== rtl ? r.left : r.right, y: icon.top, h: icon.height };
}

/**
 * Where a tray icon dragged to (x, y) lands: kept on the bar at a slot among the icons kept there (`[data-tray]`), over them or ^,
 * with the box it goes in front of; hidden, from the bar onto ^, or into the panel at a slot among its cells (`[data-tray-slot]`),
 * where an icon from the panel moves too, with the line drawn there; elsewhere null, which changes nothing.
 */
function dropAt(bar: HTMLElement | null, more: HTMLElement | null, d: { x: number; y: number; from: "panel" | "bar" }) {
  const box = document.querySelector("[data-tray-panel]")?.getBoundingClientRect();
  if (box && within(box, d.x, d.y)) {
    // While the bar's tray is folded the panel shows every icon, the kept ones too: no order among the hidden ones to change.
    if (trayFolded.get()) return d.from === "bar" ? ({ hide: true } as const) : null;
    const cells = [...document.querySelectorAll("[data-tray-slot]")];
    const rtl = document.documentElement.dir === "rtl";
    const rects = cells.map((el) => el.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height }));
    const slot = gridSlot(rects, d.x, d.y, rtl);
    return { hide: true, slot, line: panelLine(cells, slot, rtl) } as const;
  }
  if (!bar || !more || beyond(barEdgeNow(), d.y, bar.getBoundingClientRect())) return null;
  const caret = more.getBoundingClientRect();
  if (d.from === "bar" && d.x >= caret.left && d.x <= caret.right) return { hide: true } as const;
  // While the bar's tray is folded behind ^ (fit.ts) an icon kept on the bar would not be drawn: no place to keep it.
  if (trayFolded.get()) return null;
  const slots = [...bar.querySelectorAll("[data-tray]")].map((el) => el.getBoundingClientRect());
  if (d.x < (slots[0] ?? caret).left || d.x > caret.right) return null;
  const slot = dropSlot(slots.map((r) => ({ x: r.x, w: r.width })), d.x);
  return { hide: false, slot, before: slots[slot] ?? caret } as const;
}

/**
 * A tray icon dragged (trayDrag): its picture under the pointer and, where it would be kept on the bar or placed in the panel, a line
 * in the gap it goes in. Let go there it is kept there, onto ^ from the bar it is hidden, in the panel it goes to that place there,
 * anywhere else nothing changes: `trayShown` and `trayHidden` are written once per drop. Nothing of it runs while no icon is dragged.
 */
export function TrayDrop({ bar, more, size, gap }: { bar: RefObject<HTMLElement | null>; more: RefObject<HTMLElement | null>; size: number; gap: number }) {
  const drag = trayDrag.use();
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    // Taken on the way down, before the press ends the drag on the same release.
    const onUp = () => {
      const d = trayDrag.get();
      const at = d && dropAt(bar.current, more.current, d);
      if (!d || !at) return;
      updateSettings((s) => {
        const { trayShown: shown, trayHidden } = s.taskbar;
        const icons = trayState.get().icons;
        if (!at.hide) return { taskbar: { ...s.taskbar, trayShown: promote(shown, d.id, shownSlot(shown, splitTray(icons, shown).visible, at.slot)) } };
        const next = { ...s.taskbar, trayShown: demote(shown, d.id) };
        if (at.slot === undefined) return { taskbar: next };
        return { taskbar: { ...next, trayHidden: placeHidden(trayHidden, shown, splitTray(icons, shown, trayHidden).hidden, d.id, at.slot) } };
      });
    };
    addEventListener("pointerup", onUp, true);
    return () => removeEventListener("pointerup", onUp, true);
  }, [dragging, bar, more]);
  if (!drag) return null;

  const at = dropAt(bar.current, more.current, drag);
  // Centred in the gap between two buttons on the bar (itemGap), on the cell's edge in the panel, whose cells touch.
  const line = !at ? null : !at.hide ? { x: at.before.left - gap / 2, y: at.before.top + (at.before.height - size) / 2, h: size } : (at.line ?? null);
  return (
    <>
      {/* The bar's drag under Material (ItemDrop): a tonal disc at level 4 over the line, as far out as it pads in. */}
      <span className="pointer-events-none fixed top-0 left-0 flex material:z-10 material:-m-1.5 material:p-1.5 material:rounded-full material:bg-secondary-container material:shadow-level4" style={{ transform: `translate(${drag.x - size / 2}px, ${drag.y - size / 2}px)` }}>
        <TrayPicture img={drag.img} size={size} />
      </span>
      {line && (
        // 2 px wide, centred on its place.
        <span className="pointer-events-none fixed top-0 left-0 w-0.5 rounded-full bg-accent material:bg-primary" style={{ height: line.h, transform: `translate(${line.x - 1}px, ${line.y}px)` }} />
      )}
    </>
  );
}
