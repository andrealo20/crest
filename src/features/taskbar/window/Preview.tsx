import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useIsPresent } from "motion/react";
import { X } from "../../../ui/iconset";
import { fade } from "../../../design/motion";
import { t } from "../../../i18n";
import { onNativeBlur } from "../../../platform/native";
import { taskbar } from "../../../platform/services";
import { MENU_PANEL_CLASS } from "../../../ui/menu";
import { AppIcon } from "../../launcher/AppIcon";
import { menuKey, movedOrder, placeMenu, previewDrop, previewFallsBack, previewKey, previewLayout, previewSet, type BarButton } from "../model";
import { dragThreshold } from "../panelModel";
import { pressDragged, startPress } from "./press";
import { popupAt, popupY } from "../position";
import { WindowList, type HitRect } from "./BarMenu";
import { useBarEdge } from "./barEdge";

/** Room the card keeps from the window's top edge, CSS px, as a menu does. */
const EDGE = 8;
/** What the arrows step through: the tiles, or the list's rows. */
const ROWS = "[data-window],[role^=menuitem]";

/**
 * The previews of an app's windows over its button, as Windows 11 shows them: per window a tile with its icon, title and a cross
 * above a box where Rust draws the window's live thumbnail (taskbar/preview.rs), in a small window of its own over the page. Nothing
 * HTML draws over a box. The boxes go to Rust once the card has faded in and again each time they move; a box Rust answers null for
 * shows the app's icon instead, and with no thumbnail at all, or too many windows for the room, the card lists the titles. The card
 * clears the thumbnails only when its own tiles turn into the list; TaskbarWindow does when it closes or changes app, so an old card
 * fading out cannot wipe the new one's.
 */
export function PreviewCard(props: {
  b: BarButton;
  /** The app's icon, as its button draws it. */
  icon: string | null | undefined;
  /** Its button, CSS px from the window's left edge. */
  x: number;
  w: number;
  /** Its edge towards the bar, CSS px from the window's edge on the bar's side (position.ts). */
  off: number;
  /** Opened by a click, it takes the keyboard as a menu does; by a rest, it leaves it where it is. */
  by: "hover" | "click";
  /** The app's button: a press there is left to its own click. */
  anchor: Element | null;
  /** Its box each time it places itself, null once it closes: the bar's hit zone takes it in. */
  onPlace: (box: HitRect | null) => void;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
  /** A tile's or a row's window kept back by Windows ("refused"), heard after the card has closed: the app's button says so. */
  onRefused: (code: unknown) => void;
}) {
  const { b, x, w, off, by, anchor, onPlace, onClose, onRefused } = props;
  const edge = useBarEdge();
  const present = useIsPresent();
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  // The windows Rust drew no thumbnail for, by id; and whether none showed at all, which lists the titles for this card.
  const [failed, setFailed] = useState<ReadonlySet<number>>(new Set());
  const [fellBack, setFellBack] = useState(false);
  const layout = previewLayout(b.windows.length, window.innerWidth);
  const list = layout.kind === "list" || fellBack;
  // The last call's number: an answer to an older one is dropped.
  const sent = useRef(0);
  // A tile dragged sideways: its index and where its window would go (null: nowhere new), with the line's place in the card.
  const [drag, setDrag] = useState<{ from: number; at: number | null; line: number } | null>(null);
  const dropAt = (from: number, x: number, y: number) => {
    const card = ref.current?.getBoundingClientRect();
    const tiles = [...(ref.current?.querySelectorAll<HTMLElement>("[data-window]") ?? [])].map((el) => el.getBoundingClientRect());
    if (!card || !tiles.length || y < card.top || y > card.bottom || x < card.left || x > card.right) return { at: null, line: 0 };
    // In a right-to-left language the tiles run from the right: mirrored, so the slots read in order.
    const rtl = document.documentElement.dir === "rtl";
    const at = previewDrop(tiles.map((r) => (rtl ? { x: -r.right, w: r.width } : { x: r.x, w: r.width })), from, rtl ? -x : x);
    if (at === null) return { at, line: 0 };
    const edge = at < tiles.length ? (rtl ? tiles[at].right + 2 : tiles[at].x - 2) : rtl ? tiles[tiles.length - 1].x - 2 : tiles[tiles.length - 1].right + 2;
    return { at, line: edge - card.x - 1 };
  };

  const send = useCallback(() => {
    const el = ref.current;
    if (!el || !present || !ready || list) return;
    const slots = [...el.querySelectorAll<HTMLElement>("[data-slot]")].map((box) => {
      const r = box.getBoundingClientRect();
      return { id: Number(box.dataset.slot), x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const call = ++sent.current;
    taskbar.preview(slots).then(
      (answers) => {
        if (call !== sent.current) return;
        if (previewFallsBack(answers, b.windows.length)) return setFellBack(true);
        setFailed(new Set(slots.filter((_, i) => !answers[i]).map((s) => s.id)));
      },
      () => {},
    );
  }, [present, ready, list, b.windows.length]);
  // Read through a ref by the observer: a new `send` (a window closed, the fade done) must not re-run the effect below, whose
  // cleanup drops the card from the hit zone for a moment, and a poll in that gap would close the card under the pointer.
  const sendNow = useRef(send);
  useLayoutEffect(() => {
    sendNow.current = send;
  }, [send]);

  // Placed as a menu places itself, from its own size, and the boxes sent again whenever that moves them.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!present || !el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { inlineSize: width, blockSize: height } = entry.borderBoxSize[0];
      const left = placeMenu(x, w, width, window.innerWidth);
      el.style.left = `${left}px`;
      onPlace({ x: left, y: popupY(edge, off, height, window.innerHeight), w: width, h: height });
      sendNow.current();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      onPlace(null);
    };
  }, [present, x, w, off, edge, onPlace]);
  // A window coming, going, minimized or restored, or the card ready: the whole set again.
  // shortcut: a source window resized or moved while the card is open keeps its old crop until the card opens again; upgrade with a
  // location-change hook on the shown sources only (EVENT_OBJECT_LOCATIONCHANGE fires on every move of every window).
  const set = previewSet(b.windows);
  useLayoutEffect(send, [send, set]);
  // Tiles turned into the list while open: this card's thumbnails go, since no close or new app will clear them. A card being
  // replaced is no longer present, so it never wipes the next one's.
  useLayoutEffect(() => {
    if (!list || !present || sent.current === 0) return;
    sent.current++;
    void taskbar.preview([]).catch(() => {});
  }, [list, present]);
  // Opened by a click, the keyboard moves in as BarMenu's does: the first window focused (again when the tiles turn into the list),
  // Right and Left or Up and Down between them, Home and End; Esc closes it and gives the keyboard back, and a press elsewhere in
  // the bar or the window losing the focus closes it.
  useEffect(() => {
    if (!present || by !== "click") return;
    const rows = () => [...(ref.current?.querySelectorAll<HTMLElement>(ROWS) ?? [])];
    rows()[0]?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        void taskbar.release();
        return;
      }
      const all = rows();
      const to = menuKey(previewKey(e.key, document.documentElement.dir === "rtl"), all.indexOf(document.activeElement as HTMLElement), all.length);
      if (to === undefined) return;
      e.preventDefault();
      all[to].focus({ preventScroll: true });
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !anchor?.contains(target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    const offBlur = onNativeBlur(onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      offBlur();
    };
  }, [present, by, anchor, onClose, list]);

  return (
    <motion.div
      ref={ref}
      // As a list its rows are a menu's, so they sit in one.
      role={list ? "menu" : "dialog"}
      aria-label={b.name}
      dir={document.documentElement.dir}
      className={`${MENU_PANEL_CLASS} w-max flex ${list ? "min-w-40 max-w-80 flex-col" : "gap-1"}`}
      inert={!present}
      style={{ ...popupAt(edge, off), maxHeight: window.innerHeight - off - EDGE, pointerEvents: present ? undefined : "none" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: fade }}
      exit={{ opacity: 0, transition: fade }}
      onAnimationComplete={() => present && setReady(true)}
      onPointerEnter={props.onEnter}
      onPointerLeave={props.onLeave}
    >
      {drag && drag.at !== null && <span aria-hidden className="pointer-events-none absolute inset-y-2 w-0.5 rounded-full bg-accent" style={{ left: drag.line }} />}
      {list ? (
        <WindowList b={b} close={onClose} onRefused={onRefused} />
      ) : (
        b.windows.map((win, i) => (
          // Two sibling buttons, never one in the other: the tile brings the window forward, the cross closes it.
          <div key={win.id} className="relative rounded-[6px] hover:bg-fill-2 material:rounded-[12px]" style={{ width: layout.w + 12, opacity: drag?.from === i ? 0.4 : undefined }}>
            <button
              data-window
              aria-label={win.title || b.name}
              className="flex w-full touch-none flex-col gap-1.5 rounded-[6px] p-1.5 outline-none focus-visible:bg-fill-2 material:rounded-[12px] pressable-wide"
              // Dragged sideways, the tile moves its window in the row; the bar keeps that order until Crest restarts.
              onPointerDown={(e) => {
                if (b.windows.length < 2) return;
                let last = { at: null as number | null, line: 0 };
                startPress(e, {
                  threshold: dragThreshold(e.pointerType),
                  onDrag: (x, y) => {
                    last = dropAt(i, x, y);
                    setDrag({ from: i, ...last });
                  },
                  onEnd: (cancelled) => {
                    setDrag(null);
                    if (!cancelled && last.at !== null)
                      taskbar.windowOrder(movedOrder(b.windows.map((w) => w.id), i, last.at)).catch(() => {});
                  },
                });
              }}
              onClick={(e) => {
                // Only a tile that drags follows a press (two windows or more): a drag elsewhere on the bar leaves `dragged` set.
                if (b.windows.length > 1 && e.detail > 0 && pressDragged()) return;
                taskbar.window(win.id, "activate").catch(onRefused);
                onClose();
              }}
            >
              <span className="flex h-5 w-full min-w-0 items-center gap-1.5 pe-5">
                <AppIcon src={props.icon} size={16} />
                <span dir="auto" className="truncate text-footnote text-label">
                  {win.title || b.name}
                </span>
              </span>
              {/* Material's rounded frame around the square slot, as far out as it pads in: the slot keeps its box, Rust's thumbnail its rect. */}
              <span className="flex material:-m-0.5 material:p-0.5 material:rounded-[6px] material:bg-fill-1">
                <span data-slot={win.id} className="flex flex-col items-center justify-center gap-1 text-label-3" style={{ width: layout.w, height: layout.h }}>
                  {failed.has(win.id) && (
                    <>
                      <AppIcon src={props.icon} size={32} />
                      <span dir="auto" className="max-w-full truncate px-2 text-footnote">
                        {win.title || b.name}
                      </span>
                    </>
                  )}
                </span>
              </span>
            </button>
            <button
              aria-label={t("Fenster schließen")}
              className="absolute end-1.5 top-1.5 flex size-5 items-center justify-center rounded-[4px] text-label-2 outline-none hover:bg-fill-2 focus-visible:bg-fill-2 material:rounded-full"
              onClick={() => void taskbar.window(win.id, "close").catch(() => {})}
            >
              <X size={12} weight="regular" />
            </button>
          </div>
        ))
      )}
    </motion.div>
  );
}
