import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from "react";
import { AnimatePresence, animate, motion, useMotionValue, usePresence, type Transition } from "motion/react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { content, springs } from "../../../design/motion";
import { t } from "../../../i18n";
import { NotchShape } from "../../../notch/NotchShape";
import { monitorMetrics } from "../../../notch/monitor";
import { sizeExtra, sizeOverride } from "../../../notch/size";
import { held } from "../../../notch/useNotchState";
import { isNative, onNativeBlur } from "../../../platform/native";
import { taskbar } from "../../../platform/services";
import { settings } from "../../../settings/store";
import { useToolSize } from "../../window/panel";
import { limits } from "../../window/panelSize";
import { fitIcon, placeMenu } from "../model";
import { closePanel, panel, panelHeld, quickLayout, quickPage, trayDrag, type OpenPanel, type PanelContent } from "../panel";
import { CLOCK_SIZE, CRYPTO_SIZE, DISKS_SIZE, FOLDER_SIZE, PANEL_EDGE, PANEL_GAP, QUICK_PAGE_SIZE, QUICK_SIZE, SEARCH_SIZE, TOOL_FALLBACK, TRAY_SIZE, WIDGETS_SIZE, fitClock, fitPanel, panelKey, toolPanelSize } from "../panelModel";
import { barFeed } from "../barStores";
import { trayFolded, trayState } from "../tray";
import { splitTray } from "../trayModel";
import { beyond, innerOff, popupAt, popupY } from "../position";
import { itemGap } from "../look";
import type { BarEdge } from "../model";
import type { HitRect } from "./BarMenu";
import { useBarEdge } from "./barEdge";
import { CLOCK_TITLE_IDS, ClockPanel, TOOL_TITLE_ID, ToolPanel, useTabs } from "./ToolPanel";
import { TrayPanel } from "./TrayPanel";
import { CryptoPanel } from "./CryptoPanel";
import { DisksPanel, diskScan, panelDisks } from "./DisksPanel";
import { SearchPanel } from "./SearchPanel";
import { levelRows } from "../disks";

/** The panel's corners at 100 %, CSS px: the notch's open panel where it floats, without ears. */
const RADIUS = 30;

/**
 * What the panel wears, all of it from here: the tokens of its ink, its fill among them (`--color-notch`, which NotchShape paints as
 * `--shape`), and the style of a rim drawn over its edge. Without them, the theme's own and no rim, as the notch's open panel.
 */
export interface PanelSurface {
  ink?: Record<string, string>;
  rim?: CSSProperties;
}

/** Loaded the first time Stato opens it. */
const QuickPanel = lazy(() => import("./QuickPanel"));

/**
 * The panel above the bar (panel.ts) in the notch's shape and springs: it grows up out of the item it opened from, centred on it and
 * kept inside the window, PANEL_GAP past the bar on the screen's side, the whole of it drawn at Crest's scale. It closes on Esc (the
 * keyboard then goes back to the app in front), on a pointerdown anywhere else, when the window loses the focus and when the bar
 * hides; a pointerdown on an item that opens a panel is left to that item's click, which closes it or switches it. Its box takes the
 * bar's menu slot in the hit zone: the panel and the bar's menus are never open together. The apps behind "…", the hidden widgets
 * and the open folder come drawn from the bar (`apps`, `widgets` with their widths, `folder` with its name), which holds what their
 * clicks do.
 */
export function BarPanel(props: {
  bar: RefObject<HTMLElement | null>;
  onPlace: (box: HitRect | null) => void;
  apps: { count: number; grid: ReactNode };
  widgets: { widths: number[]; rows: ReactNode };
  folder: { name: string; count: number; body: ReactNode } | null;
  surface?: PanelSurface;
}) {
  const open = panel.use();
  return <AnimatePresence>{open && <Panel key="panel" open={open} {...props} />}</AnimatePresence>;
}

/**
 * The bar's top and bottom, the room from the window's edge on the bar's side to its inner edge (position.ts innerOff) and the window's
 * size, CSS px. The bar is measured, not worked out, so the gap holds for any shape of the bar.
 */
const measure = (bar: RefObject<HTMLElement | null>, edge: BarEdge) => {
  const r = bar.current?.getBoundingClientRect() ?? { top: innerHeight, bottom: 0 };
  return { span: { top: r.top, bottom: r.bottom }, off: innerOff(edge, r, innerHeight), width: innerWidth, height: innerHeight };
};

/**
 * The panel's size at 100 % for what it shows, before it is fitted to the room above the bar; null keeps the size the panel has.
 * A tool takes the size the notch gives it, less the notch's tool bar, once the tools' code has loaded. Every hook runs for every
 * content, as a switch between the tray and a tool renders the same panel.
 */
function usePanelSize(shows: PanelContent, apps: number, widgets: number[], folder: number): { w: number; h: number } | null {
  const tabs = useTabs(shows.kind === "tool");
  const tab = shows.kind === "tool" ? tabs?.findTab(shows.tool) : undefined;
  const toolSize = useToolSize(tab?.id ?? "", tab?.size ?? TOOL_FALLBACK);
  const override = sizeOverride.use();
  const extra = sizeExtra.use();
  const { height, iconSize, trayShown, shape } = settings.use().taskbar;
  const { icons } = trayState.use();
  const folded = trayFolded.use();
  const quick = quickLayout.use();
  const page = quickPage.use();
  const disks = panelDisks.use();
  const scan = diskScan.use();
  if (shows.kind === "disks") return scan ? DISKS_SIZE(levelRows(scan.levels[scan.levels.length - 1]), true) : DISKS_SIZE((disks ?? barFeed.get().disks).length);
  if (shows.kind === "tray") return TRAY_SIZE(fitIcon(height, iconSize), (folded ? icons : splitTray(icons, trayShown).hidden).length);
  if (shows.kind === "apps") return TRAY_SIZE(fitIcon(height, iconSize), apps);
  if (shows.kind === "folder") return FOLDER_SIZE(fitIcon(height, iconSize), folder);
  if (shows.kind === "widgets") return WIDGETS_SIZE(widgets, height, itemGap(shape));
  if (shows.kind === "quick") return page ? QUICK_PAGE_SIZE(page.rows, page.extra) : QUICK_SIZE(quick);
  if (shows.kind === "clock") return CLOCK_SIZE;
  if (shows.kind === "search") return SEARCH_SIZE;
  if (shows.kind === "crypto") return CRYPTO_SIZE;
  if (!tab) return null;
  // The notch's own rule (Notch.tsx): the tool's runtime request wins over the size it was given, an extra height rides on top of
  // that size, and both are held to the monitor.
  const maxH = limits(tab.size, monitorMetrics().height).maxH;
  if (override?.tabId === tab.id) return toolPanelSize({ w: override.w, h: Math.min(override.h, maxH) });
  return toolPanelSize(extra?.tabId === tab.id ? { w: toolSize.w, h: Math.min(toolSize.h + extra.h, maxH) } : toolSize);
}

function Panel({
  open,
  bar,
  onPlace,
  apps,
  widgets,
  folder,
  surface = {},
}: {
  open: OpenPanel;
  bar: RefObject<HTMLElement | null>;
  onPlace: (box: HitRect | null) => void;
  apps: { count: number; grid: ReactNode };
  widgets: { widths: number[]; rows: ReactNode };
  folder: { name: string; count: number; body: ReactNode } | null;
  surface?: PanelSurface;
}) {
  const { anchor } = open;
  const [present, safeToRemove] = usePresence();
  const ref = useRef<HTMLDivElement>(null);
  // Only the glass reads the shape's top as it springs, and the panel has no glass: it stays put.
  const top = useMotionValue(0);
  const zoom = settings.use().behavior.scale / 100;
  const edge = useBarEdge();

  // Read as the panel opens and on a resize.
  const [view, setView] = useState(() => measure(bar, edge));
  useEffect(() => {
    const onResize = () => setView(measure(bar, edge));
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, [bar, edge]);

  // A content whose size is not known yet keeps the size the panel had before it.
  const asked = usePanelSize(open.content, apps.count, widgets.widths, folder?.count ?? 1);
  const kept = useRef(asked);
  if (asked) kept.current = asked;
  const natural = asked ?? kept.current;
  const room = { w: view.width - 2 * PANEL_EDGE, h: view.height - view.off - PANEL_GAP - PANEL_EDGE };
  const clock = open.content.kind === "clock" ? fitClock(room, zoom) : null;
  const size = clock ? clock.size : natural && fitPanel(natural, room, zoom);

  // Its final box on screen, which the hit zone takes in full as soon as it opens and gives up as soon as it starts closing. While a
  // tray icon is dragged the zone is the whole window, or the window would let the pointer go as it left the panel.
  const w = size ? size.w * zoom : 0;
  const h = size ? size.h * zoom : 0;
  const left = placeMenu(anchor.x, anchor.w, w, view.width, PANEL_EDGE);
  const placed = present && size !== null;
  // Only whether a drag runs: the pointer's moves would draw the whole panel again.
  const dragging = useSyncExternalStore(trayDrag.subscribe, () => trayDrag.get() !== null);
  const box = !placed ? null : dragging ? { x: 0, y: 0, w: view.width, h: view.height } : { x: left, y: popupY(edge, view.off + PANEL_GAP, h, view.height), w, h };
  // Null is reported once: a menu can take the slot while the panel fades, and a resize meanwhile must leave its box alone.
  useLayoutEffect(() => {
    onPlace(box);
  }, [box?.x, box?.y, box?.w, box?.h, onPlace]);

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

  // A tool's select menu is portaled into the body (controls.tsx), out of the ink below: while the panel is up the body wears its ink
  // too, so the menu is as dark as the panel. The bar already wears that ink under Liquid Glass +, the only look that passes one.
  const ink = surface.ink && JSON.stringify(surface.ink);
  useLayoutEffect(() => {
    if (!ink) return;
    const vars: Record<string, string> = JSON.parse(ink);
    const body = document.body;
    body.dataset.themeInk = "";
    for (const [name, value] of Object.entries(vars)) body.style.setProperty(name, value);
    return () => {
      delete body.dataset.themeInk;
      for (const name of Object.keys(vars)) body.style.removeProperty(name);
    };
  }, [ink]);

  const tray = open.content.kind === "tray";
  useEffect(() => {
    if (!present) return;
    const onKey = (e: KeyboardEvent) => {
      // An Esc that a menu inside the panel took (a tool's select menu) closes only that menu.
      if (e.key !== "Escape" || e.defaultPrevented) return;
      closePanel();
      void taskbar.release();
    };
    // Left to the click: a pointerdown in the panel, on the item it opened from (known by its span on the bar, as the anchor is only a
    // rect), whose click closes it, or on another item that opens a panel, whose click switches it in place instead of reopening it.
    const onDown = (e: PointerEvent) => {
      const target = e.target;
      if (target instanceof Node && ref.current?.contains(target)) return;
      // A tool's select menu is portaled into the body (controls.tsx) but belongs to the panel, as it belongs to the notch (Notch.tsx).
      if (target instanceof Element && target.closest("[data-notch-menu]")) return;
      if (target instanceof Element && target.closest("[aria-haspopup=dialog]")) return;
      if (!beyond(edge, e.clientY, view.span) && e.clientX >= anchor.x && e.clientX <= anchor.x + anchor.w) return;
      // A press on a tray icon kept on the bar may drag it into the tray's panel, which stays open for it.
      if (tray && target instanceof Element && target.closest("[data-tray]")) return;
      closePanel();
    };
    addEventListener("keydown", onKey);
    addEventListener("pointerdown", onDown);
    // Windows' location prompt takes the focus while the Wi-Fi page waits for it (WifiPage.tsx), and a tool's picker while it holds the
    // notch open (holdOpen): Colour's eyedropper, the Launcher's file dialog.
    const offBlur = onNativeBlur(() => panelHeld.get() || held() || closePanel());
    // The bar hides with the hide hotkey or over a full-screen app, and its panel with it. On this window only: with a bar on each
    // monitor, another bar hiding must not close this one's panel.
    const offShown = isNative ? getCurrentWebviewWindow().listen<boolean>("taskbar://shown", (e) => !e.payload && closePanel()) : null;
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("pointerdown", onDown);
      offBlur();
      void offShown?.then((off) => off());
    };
  }, [present, edge, view.span, anchor.x, anchor.w, tray]);

  return (
    <motion.div
      ref={ref}
      // A tool's select menu stays inside the closest hit zone (controls.tsx), as in the notch. Here that is the panel's box: outside
      // it the window lets the pointer through, so a pick in a menu that hung past it would land in the window below.
      data-notch-hit
      role="dialog"
      aria-label={
        open.content.kind === "tray"
          ? t("Infobereich")
          : open.content.kind === "apps"
            ? t("Weitere Apps")
            : open.content.kind === "quick"
              ? t("Schnelleinstellungen")
              : open.content.kind === "disks"
                ? t("Speicherplatz")
                : open.content.kind === "search"
                  ? t("Suchen oder öffnen")
                  : open.content.kind === "crypto"
                    ? t("Krypto")
                    : open.content.kind === "widgets"
                      ? t("Weitere Widgets")
                      : open.content.kind === "folder"
                        ? folder?.name
                        : undefined
      }
      aria-labelledby={open.content.kind === "tool" || clock?.alone ? TOOL_TITLE_ID : clock ? CLOCK_TITLE_IDS : undefined}
      // Closing, it takes no key and no click: its zone is already gone.
      inert={!present}
      className="fixed left-0 -translate-x-1/2"
      style={{ ...popupAt(edge, view.off + PANEL_GAP), x, pointerEvents: present ? undefined : "none" }}
    >
      {/* Drawn at Crest's scale, as the notch's panel is; the box around it is in the window's px. An ink of its own sets the text's
          colour again (body's is worked out from the theme's label) and is marked, so forced colours still override it (themes.css).
          Material puts a panel above the bar at level 3; the notch's open panel stays at level 4. */}
      <div className="material:[--shadow-panel:var(--shadow-level3)]" data-theme-ink={surface.ink ? "" : undefined} style={{ zoom, ...(surface.ink && { ...surface.ink, color: "var(--color-label)" }) }}>
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
                  // A switch between two tools keeps the tool panel, which crossfades the tool below its own header (ToolPanel.tsx);
                  // one between two folders crossfades the folders.
                  key={open.content.kind === "folder" ? panelKey(open.content) : open.content.kind}
                  // Laid out at its full size from the centre of its side towards the bar, so it stays put while the shape grows around it.
                  className={`absolute ${edge === "top" ? "top-0" : "bottom-0"} left-1/2`}
                  style={{ width: size.w, height: size.h, marginLeft: -size.w / 2 }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: content.enter }}
                  exit={{ opacity: 0, transition: content.exit }}
                >
                  {open.content.kind === "tray" ? (
                    <TrayPanel />
                  ) : open.content.kind === "apps" ? (
                    apps.grid
                  ) : open.content.kind === "widgets" ? (
                    widgets.rows
                  ) : open.content.kind === "folder" ? (
                    folder?.body
                  ) : open.content.kind === "tool" ? (
                    <ToolPanel tool={open.content.tool} />
                  ) : open.content.kind === "disks" ? (
                    <DisksPanel />
                  ) : open.content.kind === "search" ? (
                    <SearchPanel />
                  ) : open.content.kind === "crypto" ? (
                    <CryptoPanel />
                  ) : clock ? (
                    // Too short for both halves (fitClock): the Calendar alone, as the Next event widget opens it.
                    clock.alone ? <ToolPanel tool="calendar" /> : <ClockPanel />
                  ) : (
                    <Suspense fallback={null}>
                      <QuickPanel />
                    </Suspense>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
          {/* Over the content and with the shape, not with the content's fade. */}
          {surface.rim && <div aria-hidden className="pointer-events-none absolute inset-0" style={{ borderRadius: RADIUS, ...surface.rim }} />}
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
