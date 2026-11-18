import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { AnimatePresence, animate, motion, useMotionValue, usePresence, type Transition } from "motion/react";
import { listen } from "@tauri-apps/api/event";
import { content, springs } from "../../../design/motion";
import { t } from "../../../i18n";
import { NotchShape } from "../../../notch/NotchShape";
import { isNative, onNativeBlur } from "../../../platform/native";
import { taskbar } from "../../../platform/services";
import { settings } from "../../../settings/store";
import { placeMenu } from "../model";
import { closePanel, panel, type OpenPanel, type PanelContent } from "../panel";
import { APPS_SIZE, PANEL_EDGE, PANEL_GAP, fitPanel, panelKey } from "../panelModel";
import { AppsView } from "./AppsView";
import type { HitRect } from "./BarMenu";

/** The panel's corners at 100 %, CSS px: the notch's open panel where it floats, without ears. */
const RADIUS = 30;

/**
 * The panel above the bar (panel.ts) in the notch's shape and springs: it grows up out of the item it opened from, centred on it and
 * kept inside the window, its bottom edge PANEL_GAP above the bar, the whole of it drawn at Crest's scale. It closes on Esc (the
 * keyboard then goes back to the app in front), on a pointerdown anywhere else, when the window loses the focus and when the bar
 * hides; a pointerdown on an item that opens a panel is left to that item's click, which closes it or switches it. Its box takes the
 * bar's menu slot in the hit zone: the panel and the bar's menus are never open together.
 */
export function BarPanel(props: { bar: RefObject<HTMLElement | null>; onPlace: (box: HitRect | null) => void }) {
  const open = panel.use();
  return <AnimatePresence>{open && <Panel key="panel" open={open} {...props} />}</AnimatePresence>;
}

/** The bar's top edge and the window's size, CSS px. The edge is measured, not worked out, so the gap holds for any shape of the bar. */
const measure = (bar: RefObject<HTMLElement | null>) => ({ barTop: bar.current?.getBoundingClientRect().top ?? innerHeight, width: innerWidth, height: innerHeight });

/** The panel's size at 100 % for what it shows, before it is fitted to the room above the bar; null keeps the size the panel has. */
function usePanelSize(shows: PanelContent): { w: number; h: number } | null {
  return shows.kind === "apps" ? APPS_SIZE : null;
}

function Panel({ open, bar, onPlace }: { open: OpenPanel; bar: RefObject<HTMLElement | null>; onPlace: (box: HitRect | null) => void }) {
  const { anchor } = open;
  const [present, safeToRemove] = usePresence();
  const ref = useRef<HTMLDivElement>(null);
  // Only the glass reads the shape's top as it springs, and the panel has no glass: it stays put.
  const top = useMotionValue(0);
  const zoom = settings.use().behavior.scale / 100;

  // Read as the panel opens and on a resize.
  const [view, setView] = useState(() => measure(bar));
  useEffect(() => {
    const onResize = () => setView(measure(bar));
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, [bar]);

  // A content whose size is not known yet keeps the size the panel had before it.
  const asked = usePanelSize(open.content);
  const kept = useRef(asked);
  if (asked) kept.current = asked;
  const natural = asked ?? kept.current;
  const size = natural && fitPanel(natural, { w: view.width - 2 * PANEL_EDGE, h: view.barTop - PANEL_GAP - PANEL_EDGE }, zoom);

  // Its final box on screen, which the hit zone takes in full as soon as it opens and gives up as soon as it starts closing.
  const w = size ? size.w * zoom : 0;
  const h = size ? size.h * zoom : 0;
  const left = placeMenu(anchor.x, anchor.w, w, view.width, PANEL_EDGE);
  const placed = present && size !== null;
  useLayoutEffect(() => {
    onPlace(placed ? { x: left, y: view.barTop - PANEL_GAP - h, w, h } : null);
  }, [placed, left, view.barTop, w, h, onPlace]);

  // Mounted closed over its item and grown on the next commit: NotchShape springs to a new geometry, never to its first one.
  const [grown, setGrown] = useState(false);
  useEffect(() => setGrown(true), []);
  const shown = placed && grown;
  const geometry = shown && size ? { w: size.w, h: size.h, r: RADIUS, ear: 0, rt: RADIUS } : { w: anchor.w / zoom, h: 0, r: RADIUS, ear: 0, rt: RADIUS };
  const shapeSpring = useSpringFor(`${geometry.w}x${geometry.h}`, shown);

  // The centre moves with the shape: out of the item as it opens, to the next item on a switch, back into it as it closes. Open, it
  // rests on a whole pixel: text in a box moved by a fraction of a pixel blurs.
  const centre = shown ? Math.round(left + w / 2) : anchor.x + anchor.w / 2;
  const centreSpring = useSpringFor(String(centre), shown);
  const x = useMotionValue(centre);
  useEffect(() => {
    const c = animate(x, centre, { ...centreSpring, restDelta: 0.01, restSpeed: 0.1 });
    return () => c.stop();
  }, [x, centre, centreSpring]);

  // NotchShape says nothing when its spring settles: the panel goes once the closing shape has no height left.
  useEffect(() => {
    const el = ref.current;
    if (present || !el) return;
    const observer = new ResizeObserver(([entry]) => entry.contentRect.height === 0 && safeToRemove());
    observer.observe(el);
    return () => observer.disconnect();
  }, [present, safeToRemove]);

  useEffect(() => {
    if (!present) return;
    const onKey = (e: KeyboardEvent) => {
      // An Esc that a menu inside the panel took (the app menu's pin menu) closes only that menu.
      if (e.key !== "Escape" || e.defaultPrevented) return;
      closePanel();
      void taskbar.release();
    };
    // Left to the click: a pointerdown in the panel, on the item it opened from (known by its span on the bar, as the anchor is only a
    // rect), whose click closes it, or on another item that opens a panel, whose click switches it in place instead of reopening it.
    const onDown = (e: PointerEvent) => {
      const target = e.target;
      if (target instanceof Node && ref.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[aria-haspopup=dialog]")) return;
      if (e.clientY >= view.barTop && e.clientX >= anchor.x && e.clientX <= anchor.x + anchor.w) return;
      closePanel();
    };
    addEventListener("keydown", onKey);
    addEventListener("pointerdown", onDown);
    const offBlur = onNativeBlur(closePanel);
    // The bar hides with the hide hotkey or over a full-screen app, and its panel with it.
    const offShown = isNative ? listen<boolean>("taskbar://shown", (e) => !e.payload && closePanel()) : null;
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("pointerdown", onDown);
      offBlur();
      void offShown?.then((off) => off());
    };
  }, [present, view.barTop, anchor.x, anchor.w]);

  return (
    <motion.div
      ref={ref}
      role="dialog"
      aria-label={open.content.kind === "apps" ? t("App-Menü") : undefined}
      // Closing, it takes no key and no click: its zone is already gone.
      inert={!present}
      className="fixed left-0 -translate-x-1/2"
      style={{ bottom: view.height - view.barTop + PANEL_GAP, x, pointerEvents: present ? undefined : "none" }}
    >
      {/* Drawn at Crest's scale, as the notch's panel is; the box around it is in the window's px. */}
      <div style={{ zoom }}>
        <NotchShape geometry={geometry} transition={shapeSpring} elevated top={top} hangs={false}>
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: content.enter }}
            exit={{ opacity: 0, transition: content.exit }}
          >
            <AnimatePresence initial={false}>
              {size && (
                <motion.div
                  key={panelKey(open.content)}
                  // Laid out at its full size from the bottom centre, so it stays put while the shape grows up around it.
                  className="absolute bottom-0 left-1/2"
                  style={{ width: size.w, height: size.h, marginLeft: -size.w / 2 }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: content.enter }}
                  exit={{ opacity: 0, transition: content.exit }}
                >
                  {open.content.kind === "apps" && <AppsView />}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </NotchShape>
      </div>
    </motion.div>
  );
}

/**
 * The spring that takes the panel to `to`: the opening one from the closed shape, the morph from one open shape to another, the
 * closing one back. Kept while `to` stays, as Notch.tsx keeps its own: a new transition would restart a running spring from rest.
 */
function useSpringFor(to: string, shown: boolean): Transition {
  const was = useRef(shown);
  const last = useRef<{ to: string; spring: Transition }>({ to, spring: springs.open });
  if (last.current.to !== to) last.current = { to, spring: !shown ? springs.close : was.current ? springs.morph : springs.open };
  useEffect(() => {
    was.current = shown;
  });
  return last.current.spring;
}
