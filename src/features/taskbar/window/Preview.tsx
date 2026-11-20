import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useIsPresent } from "motion/react";
import { X } from "../../../ui/iconset";
import { fade } from "../../../design/motion";
import { t } from "../../../i18n";
import { onNativeBlur } from "../../../platform/native";
import { taskbar } from "../../../platform/services";
import { MENU_PANEL_CLASS } from "../../../ui/menu";
import { AppIcon } from "../../launcher/AppIcon";
import { menuKey, placeMenu, previewFallsBack, previewKey, previewLayout, previewSet, type BarButton } from "../model";
import { WindowList, type HitRect } from "./BarMenu";

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
  /** Its bottom edge, CSS px above the window's bottom edge. */
  bottom: number;
  /** Opened by a click, it takes the keyboard as a menu does; by a rest, it leaves it where it is. */
  by: "hover" | "click";
  /** The app's button: a press there is left to its own click. */
  anchor: Element | null;
  /** Its box each time it places itself, null once it closes: the bar's hit zone takes it in. */
  onPlace: (box: HitRect | null) => void;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const { b, x, w, bottom, by, anchor, onPlace, onClose } = props;
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
      onPlace({ x: left, y: window.innerHeight - bottom - height, w: width, h: height });
      sendNow.current();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      onPlace(null);
    };
  }, [present, x, w, bottom, onPlace]);
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
      style={{ bottom, maxHeight: window.innerHeight - bottom - EDGE, pointerEvents: present ? undefined : "none" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: fade }}
      exit={{ opacity: 0, transition: fade }}
      onAnimationComplete={() => present && setReady(true)}
      onPointerEnter={props.onEnter}
      onPointerLeave={props.onLeave}
    >
      {list ? (
        <WindowList b={b} close={onClose} />
      ) : (
        b.windows.map((win) => (
          // Two sibling buttons, never one in the other: the tile brings the window forward, the cross closes it.
          <div key={win.id} className="relative rounded-[6px] hover:bg-fill-2" style={{ width: layout.w + 12 }}>
            <button
              data-window
              aria-label={win.title || b.name}
              className="flex w-full flex-col gap-1.5 rounded-[6px] p-1.5 outline-none focus-visible:bg-fill-2"
              onClick={() => {
                // A window of an app run as administrator may refuse; nothing changes then.
                taskbar.window(win.id, "activate").catch(() => {});
                onClose();
              }}
            >
              <span className="flex h-5 w-full min-w-0 items-center gap-1.5 pe-5">
                <AppIcon src={props.icon} size={16} />
                <span dir="auto" className="truncate text-footnote text-label">
                  {win.title || b.name}
                </span>
              </span>
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
            </button>
            <button
              aria-label={t("Fenster schließen")}
              className="absolute end-1.5 top-1.5 flex size-5 items-center justify-center rounded-[4px] text-label-2 outline-none hover:bg-fill-2 focus-visible:bg-fill-2"
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
