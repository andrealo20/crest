import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type Dispatch, type MouseEventHandler, type RefObject, type SetStateAction } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion } from "motion/react";
import { DotsThree } from "@phosphor-icons/react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { springs } from "../../../design/motion";
import { t } from "../../../i18n";
import { partInfo } from "../../../notch/row/partInfo";
import type { PartId } from "../../../notch/row/parts";
import { isNative } from "../../../platform/native";
import { launcher, taskbar } from "../../../platform/services";
import { settings } from "../../../settings/store";
import { CrestMark } from "../../../ui/CrestMark";
import { WindowsMark } from "../../../ui/WindowsMark";
import { AppIcon } from "../../launcher/AppIcon";
import { useIcons } from "../../launcher/store";
import { useThemedAccent } from "../../themes/store";
import { zones as hitZones, type Rect } from "../autoHide";
import { COMPACT_PAD, barButtons, clickAction, compactIcon, fitIcon, indicator, launchId, trayIcon, type BarButton, type BarItem, type BarShape, type Zone } from "../model";
import { LOOK, barGap, groupBoxes, hitBoxes, labelRise, type Box } from "../look";
import { closePanel, panel, togglePanel } from "../panel";
import { barShown, barWindows, groupIcons } from "../store";
import { splitApps } from "../fit";
import { barStatus } from "../status";
import { batteryGlyph, netGlyph, soundGlyph } from "../statusModel";
import { trayFolded, trayState } from "../tray";
import { splitTray } from "../trayModel";
import { isWidget, widgetTool } from "../widgets";
import { BarGlass, useBarSurface } from "./BarGlass";
import { Capsule } from "./Capsule";
import { AppsPanel } from "./AppsPanel";
import { AppMenu, BarMenu, CrestMenu, WindowList, type HitRect } from "./BarMenu";
import { BarPanel } from "./BarPanel";
import { holdBriefly } from "./hold";
import { Item, MARK } from "./Item";
import { Status } from "./Status";
import { Tray, TrayDrop } from "./Tray";
import { useAppFit } from "./useAppFit";
import { useAutoHide } from "./useAutoHide";
import { WidgetItem } from "./Widget";

/** Room between the bar and a menu above it, CSS px, as between a button and its name. */
const MENU_GAP = 8;
const ZONES: [Zone, string][] = [
  ["left", "justify-start"],
  ["center", "justify-center"],
  ["right", "justify-end"],
];
/** The primary bar, the window labelled `taskbar`: only it draws widgets and follows the notch (main.tsx); the bars on other monitors skip both. */
export const primary = !isNative || getCurrentWebviewWindow().label === "taskbar";

/** What a menu lists: an app's right-click menu, an app's windows (as they were when it opened), or the Crest menu. */
type Menu = { kind: "app" | "list"; b: BarButton } | { kind: "crest" };
/** An open menu, the button it opened from (null: a right click beside the buttons) and the span it opens over, CSS px. */
type OpenMenu = Menu & { anchor: Element | null; x: number; w: number };

/*
 *   ╭──────────────────────────────────────────────────────────────╮
 *   │                  [app] [app] [app•] [app▬]               [C] │
 *   ╰──────────────────────────────────────────────────────────────╯
 *    left                       center                       right
 *
 * The window is much taller than the bar and lets the pointer through outside the zones it reports, so the names and the menus
 * show above the bar. Nothing runs between events: a list from Rust, a setting, an icon arriving, the pointer onto a button or
 * off it, a click.
 */
export function TaskbarWindow() {
  const { zones, height, iconSize, pinned, shape, trayShown } = settings.use().taskbar;
  const { visible: trayVisible } = splitTray(trayState.use().icons, trayShown);
  const { groups, active } = barWindows.use();
  const accent = useThemedAccent(undefined);
  // Rust hides the window without telling WebView2 the page is out of sight, so the widgets rest by this instead. It reads false
  // while the bar is slid off the screen too (taskbar.slid below).
  const paused = !barShown.use();
  const bar = useRef<HTMLDivElement>(null);
  // The tray's ^ button: a tray icon dragged onto the bar lands between the first kept icon and it.
  const trayMore = useRef<HTMLButtonElement>(null);
  // The button under the pointer, and a launch that failed (in its button's label for a while).
  const [hovered, setHovered] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(null);
  const [menu, setOpenMenu] = useState<OpenMenu | null>(null);
  // The panel above the bar shares the menus' place in the hit zone: opening one closes the other. Every menu closes the panel here,
  // wherever it is set from, or one set while the panel is open would wait hidden behind it and pop up once it closes.
  const setMenu = useCallback((next: OpenMenu | null) => {
    if (next) closePanel();
    setOpenMenu(next);
  }, []);
  const closeMenu = useCallback(() => setMenu(null), [setMenu]);
  const open = panel.use();
  useEffect(() => {
    if (open) setMenu(null);
  }, [open]);
  // The shape's boxes, for its glass: new ones only when they change, so a hover does not draw the glass again.
  const [boxes, setBoxes] = useState<Box[]>([]);
  // The pointer's x over the bar, Infinity off it: the magnified icons follow it without React drawing anything.
  const pointer = useMotionValue(Infinity);
  const reduced = useReducedMotion() === true;
  // Once the window lets the pointer through, the page sees no pointerleave: Rust says when the pointer left the bar.
  useEffect(
    () =>
      taskbar.onHover((inside) => {
        if (inside) return;
        setHovered(null);
        pointer.set(Infinity);
      }),
    [pointer],
  );
  useEffect(() => {
    if (!error) return;
    const id = window.setTimeout(() => setError(null), 3000);
    return () => window.clearTimeout(id);
  }, [error]);

  const buttons = barButtons(pinned, groups);
  const icons = useIcons(buttons.flatMap((b) => launchId(b) ?? []));
  const ownIcons = groupIcons.use();
  const size = fitIcon(height, iconSize);
  // The mark sits in the middle of the room under the icon, on whole pixels.
  const markAt = Math.round(((height - size) / 2 - MARK) / 2);
  const gap = barGap(shape);
  const tiles = shape === "tiles";
  // Too many apps for the room: narrower buttons, then the last ones behind "…", the app in front and those asking for attention kept
  // shown; and with too little room even for one app and "…", the tray's kept icons and then the widgets give way (fit.ts).
  // Stato's glyphs: one coming or going changes its width, and with none it draws nothing the fit could observe.
  const glyphs = useSyncExternalStore(barStatus.subscribe, () => {
    const s = barStatus.get();
    return [s.network && netGlyph(s.network), soundGlyph(s.sound), batteryGlyph(s.power)].filter(Boolean).length;
  });
  const fit = useAppFit(bar, { zones, shape, size, count: buttons.length, trayCount: trayVisible.length, primary, glyphs });
  const kept = [...buttons.filter((b) => b.windows.some((w) => w.id === active)), ...buttons.filter((b) => indicator(b, active) === "attention")].map((b) => b.key);
  const shown = new Set(splitApps(buttons.map((b) => b.key), fit.mode === "overflow" ? fit.visible : buttons.length, kept).shown);
  const shownButtons = buttons.filter((b) => shown.has(b.key));
  const hiddenButtons = buttons.filter((b) => !shown.has(b.key));
  const narrow = fit.mode !== "full";
  const appIcon = narrow ? compactIcon(size) : size;
  const appWidth = narrow ? compactIcon(size) + COMPACT_PAD : undefined;
  useEffect(() => trayFolded.set(fit.trayBack), [fit.trayBack]);
  // Every app fits again: "…" goes, and so does its panel, which would stay open and empty.
  useEffect(() => {
    if (fit.mode !== "overflow" && panel.get()?.content.kind === "apps") closePanel();
  }, [fit.mode]);
  // Start, the apps, "…" and Crest grow as a dock's icons, by the pitch of the apps in use; widgets and tray icons only lift.
  const mag = reduced ? undefined : { pointer, unit: (narrow ? compactIcon(size) + COMPACT_PAD : size + 16) + (tiles ? LOOK.tileGap : 2), rise: labelRise(size, height) };
  // The tiles' boxes move without the bar resizing when a button comes or goes, or the icons change size (a tile is size + 16 wide).
  // An open menu or panel holds the bar up, and so does an app asking for attention.
  const layout = `${buttons.map((b) => b.key)}|${JSON.stringify(zones)}|${size}|${trayVisible.map((i) => i.key)}|${fit.mode}:${fit.visible}:${fit.trayBack}:${fit.hide}|${glyphs}`;
  const { down, place: placeMenuZone } = useHitZone(bar, shape, setBoxes, layout, {
    open: menu !== null || open !== null,
    attention: buttons.some((b) => indicator(b, active) === "attention"),
  });
  // Down, Rust tells this bar, and the notch for the primary's, that it is hidden (bar.rs taskbar_slid): the widgets and their sources
  // rest as when it hides. Once per change, and once on load, which clears a slide the page left behind before a reload.
  useEffect(() => void taskbar.slid(down), [down]);
  // Slid off the screen, the bar runs no glass, as when it hides.
  const look = useBarSurface(boxes, down);
  // The shape slides out of its still box by its height and the gap under it, off the screen (useAutoHide).
  const slide = { initial: false, animate: { y: down ? height + gap : 0 }, transition: springs.snappy } as const;
  // In the order the tiles are drawn and measured: past LOOK.maxTiles the glass does not draw them, and they keep the veil.
  let tileCount = 0;
  const tile = () => (tiles ? { background: tileCount++ < LOOK.maxTiles ? look.background : look.plain, radius: look.radius } : undefined);

  /** Opens a menu over its button, or closes it on a second click there; another button's menu takes the place of an open one. */
  const toggle = (next: Menu, anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect();
    setMenu(menu?.kind === next.kind && menu.anchor === anchor ? null : { ...next, anchor, x: r.x, w: r.width });
  };
  const openCrestMenu: MouseEventHandler<HTMLButtonElement> = (e) => toggle({ kind: "crest" }, e.currentTarget);

  const launch = (b: BarButton, id: string) =>
    launcher.open(id).catch((code) => setError({ key: b.key, text: t(code === "not-found" ? "{name} ist nicht mehr installiert" : "{name} startet nicht", { name: b.name }) }));

  const click = (b: BarButton, button: HTMLElement) => {
    setError(null);
    const action = clickAction(b);
    if (action.kind === "list") return toggle({ kind: "list", b }, button);
    setMenu(null);
    if (action.kind === "launch") launch(b, action.id);
    // A window of an app run as administrator may refuse; nothing changes then.
    else if (action.kind === "toggle") taskbar.window(action.id, "toggle").catch(() => {});
  };

  /** A widget opens its tool in the panel over it; the clock opens Windows' calendar instead, as Windows' own clock does. */
  const clickWidget = (id: PartId, button: HTMLElement) => {
    setError(null);
    setMenu(null);
    const tool = widgetTool(id);
    // Windows may refuse to open it; nothing changes then. The bar stays up while it comes to the front.
    if (tool === null) {
      holdBriefly();
      return void taskbar.calendar().catch(() => {});
    }
    const r = button.getBoundingClientRect();
    togglePanel({ kind: "tool", tool }, { x: r.x, w: r.width });
  };

  const item = (key: string, name: string) => ({
    name,
    // An open menu or panel hides the names, which would show around it.
    label: menu || open ? null : error?.key === key ? error.text : hovered === key ? name : null,
    failed: error?.key === key,
    lifted: hovered === key,
    size,
    markAt,
    onEnter: () => setHovered(key),
    onLeave: () => setHovered((h) => (h === key ? null : h)),
  });

  // Each item draws in a branch of its own: an item added to BarItem without one is a type error, not a second Crest button.
  const render = (id: BarItem) => {
    if (id === "start")
      return (
        <Item
          {...item("start", t("Startmenü"))}
          kind="start"
          magnify={mag}
          tile={tile()}
          // Windows' own Start and its Win+X menu, the bar held up while they come to the front; Windows may refuse, and nothing changes then.
          onClick={() => {
            holdBriefly();
            void taskbar.shell("start").catch(() => {});
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            holdBriefly();
            void taskbar.shell("winx").catch(() => {});
          }}
        >
          <WindowsMark size={Math.round(size * 0.72)} />
        </Item>
      );
    if (id === "apps") {
      const apps = shownButtons.map((b) => {
        const entry = launchId(b);
        return (
          <Item
            key={b.key}
            {...item(b.key, b.name)}
            tile={tile()}
            width={appWidth}
            magnify={mag}
            mark={indicator(b, active)}
            onClick={(e) => click(b, e.currentTarget)}
            onContextMenu={(e) => toggle({ kind: "app", b }, e.currentTarget)}
          >
            <AppIcon src={entry === null ? ownIcons[b.key] : icons[entry]} size={appIcon} />
          </Item>
        );
      });
      if (fit.mode !== "overflow") return apps;
      const n = hiddenButtons.length;
      // A launch from the panel that failed shows here, as its app has no button of its own on the bar.
      const failed = error !== null && hiddenButtons.some((b) => b.key === error.key);
      return [
        ...apps,
        <Item
          key="apps-more"
          {...item("apps-more", t(n === 1 ? "{n} weitere App" : "{n} weitere Apps", { n }))}
          {...(failed && { label: menu || open ? null : error.text, failed })}
          tile={tile()}
          width={appWidth}
          magnify={mag}
          // Open or asking for attention, as one app with every hidden app's windows.
          mark={indicator({ key: "", name: "", pin: null, pins: [], windows: hiddenButtons.flatMap((b) => b.windows) }, active)}
          expanded={open?.content.kind === "apps"}
          onClick={(e) => {
            setError(null);
            const r = e.currentTarget.getBoundingClientRect();
            togglePanel({ kind: "apps" }, { x: r.x, w: r.width });
          }}
          // No menu of its own, as ^: the Crest menu over the pointer.
          onContextMenu={(e) => setMenu({ kind: "crest", anchor: null, x: e.clientX, w: 0 })}
        >
          <DotsThree size={appIcon} weight="regular" />
        </Item>,
      ];
    }
    if (isWidget(id)) {
      if (!primary || fit.hide.includes(id)) return null;
      const tool = widgetTool(id);
      return (
        <WidgetItem
          id={id}
          // A widget that opens a tool says whether the panel shows it, so a press on it is left to its click and the panel moves in place.
          item={{ ...item(id, t(partInfo[id].label)), kind: id, tile: tile(), expanded: tool === null ? undefined : open?.content.kind === "tool" && open.content.tool === tool }}
          paused={paused}
          onClick={(e) => clickWidget(id, e.currentTarget)}
          // No menu of its own: the Crest menu over the pointer, as beside the buttons.
          onContextMenu={(e) => setMenu({ kind: "crest", anchor: null, x: e.clientX, w: 0 })}
        />
      );
    }
    if (id === "tray")
      return (
        <Tray
          visible={fit.trayBack ? [] : trayVisible}
          size={size}
          item={item}
          tile={tile}
          tiles={tiles}
          more={trayMore}
          // No menu of its own, as a widget: the Crest menu over the pointer.
          onMenu={(e) => setMenu({ kind: "crest", anchor: null, x: e.clientX, w: 0 })}
        />
      );
    if (id === "status")
      return (
        <Status
          size={size}
          item={item}
          tile={tile}
          expanded={open?.content.kind === "quick"}
          onClick={(e) => {
            setError(null);
            setMenu(null);
            const r = e.currentTarget.getBoundingClientRect();
            togglePanel({ kind: "quick" }, { x: r.x, w: r.width });
          }}
          // No menu of its own, as a widget: the Crest menu over the pointer.
          onMenu={(e) => setMenu({ kind: "crest", anchor: null, x: e.clientX, w: 0 })}
        />
      );
    if (id === "crest")
      return (
        <Item {...item("crest", t("Crest-Menü"))} kind="crest" tile={tile()} magnify={mag} onClick={openCrestMenu} onContextMenu={openCrestMenu}>
          <CrestMark size={size} />
        </Item>
      );
    return id satisfies never;
  };

  return (
    <div
      // Clipped, so the bar slid off the screen leaves #root nothing to scroll to when one of its buttons takes the focus.
      className="flex h-full flex-col justify-end overflow-clip"
      style={{ ["--accent" as string]: accent }}
      // A right click beside the buttons, on the bar or in the gap under it: the Crest menu, over the pointer. Not in the panel.
      onContextMenu={(e) => {
        if ((e.target as Element).closest("button, [role=menu], [role=dialog]")) return;
        setMenu({ kind: "crest", anchor: null, x: e.clientX, w: 0 });
      }}
    >
      {/* On the closed notch's black the bar and its menus keep their dark tokens whatever the theme (Notch.tsx), and its zones keep their sides in any language. */}
      <div data-theme-ink dir="ltr" className="contents" style={look.ink}>
        {look.glass && <BarGlass {...look.glass} />}
        {/* The shape's place stays still, so its box is the band at rest while the shape slides out of it (useHitZone measures this box). */}
        <div
          ref={bar}
          className={shape === "capsule" ? "self-center" : undefined}
          style={{ margin: shape === "capsule" ? `0 0 ${gap}px` : `0 ${gap}px ${gap}px` }}
          // The bar only, never a menu or the panel above it.
          onPointerMove={(e) => pointer.set(e.clientX)}
          onPointerLeave={() => pointer.set(Infinity)}
        >
          {/* Positioned, so it draws over the glass's canvas. The capsule puts the three zones in a row, as close as its buttons. */}
          {shape === "capsule" ? (
            <motion.div {...slide}>
              <Capsule style={{ height, borderRadius: look.radius, background: look.background }}>
                {ZONES.map(([zone]) => zones[zone].map((id) => <Fragment key={id}>{render(id)}</Fragment>))}
              </Capsule>
            </motion.div>
          ) : (
            <motion.div
              {...slide}
              className="relative grid grid-cols-[1fr_auto_1fr] px-1 text-label"
              style={{ height, borderRadius: look.radius, background: tiles ? undefined : look.background }}
            >
              {ZONES.map(([zone, justify]) => (
                // A side zone holding the apps grows to them and moves the centre aside; the fit leaves the other side its room.
                <div key={zone} className={`flex gap-0.5 ${justify} ${zone !== "center" && zones[zone].includes("apps") ? "" : "min-w-0"}`} style={tiles ? { gap: LOOK.tileGap } : undefined}>
                  {zones[zone].map((id) => (
                    <Fragment key={id}>{render(id)}</Fragment>
                  ))}
                </div>
              ))}
            </motion.div>
          )}
        </div>
        <AnimatePresence>
          {/* Gone in the very commit the panel opens in, so its zone is cleared before the panel's box goes in, never after. */}
          {menu && !open && (
            <BarMenu
              key={`${menu.kind}@${menu.x}`}
              title={menu.kind === "crest" ? t("Crest-Menü") : menu.b.name}
              x={menu.x}
              w={menu.w}
              bottom={gap + height + MENU_GAP}
              anchor={menu.anchor}
              onClose={closeMenu}
              onPlace={placeMenuZone}
            >
              {menu.kind === "crest" ? (
                <CrestMenu close={closeMenu} />
              ) : menu.kind === "app" ? (
                <AppMenu b={menu.b} launch={(id) => launch(menu.b, id)} close={closeMenu} />
              ) : (
                <WindowList b={menu.b} close={closeMenu} />
              )}
            </BarMenu>
          )}
        </AnimatePresence>
      </div>
      {/* Outside the bar's ink: the panel has the theme's colours whatever the bar's background, as the notch's open panel has. */}
      <BarPanel
        bar={bar}
        onPlace={placeMenuZone}
        apps={{
          count: hiddenButtons.length,
          grid: (
            <AppsPanel
              apps={hiddenButtons.map((b) => {
                const entry = launchId(b);
                return { b, icon: entry === null ? ownIcons[b.key] : icons[entry], mark: indicator(b, active) };
              })}
              size={size}
              // In the middle of the 8 px under the cell's icon, as markAt is under the bar's.
              markAt={Math.round((8 - MARK) / 2)}
              // A click does what the bar's does, over the cell: a window list or an app menu takes the panel's place.
              onClick={(b, cell) => {
                closePanel();
                click(b, cell);
              }}
              onMenu={(b, cell) => toggle({ kind: "app", b }, cell)}
            />
          ),
        }}
      />
      <TrayDrop bar={bar} more={trayMore} size={trayIcon(size)} />
      {/* The launch error for screen readers too: a button's label is not read out. */}
      <span role="status" aria-live="polite" className="sr-only">
        {error?.text}
      </span>
    </div>
  );
}

/** An element's box on the page, CSS px. */
const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
};

/**
 * Tells Rust where the page takes the pointer (autoHide.ts zones): the bar (or the capsule) and the gap under it, so a click in the gap
 * never reaches the app behind, or for the tiles one box per zone round its tiles, so a click between the zones does; the open menu or
 * panel, whose box comes through `place` each time it places itself (null once it closes); with "hide when a window touches it" on,
 * the strip at the bottom edge too, alone while the bar is down. The bar counts only once it has a size: the first report says it has
 * drawn, and Windows' taskbar hides then. The boxes are where the shape rests, up or down: `ref` is its still box, the band that
 * decides whether it is down (useAutoHide), and the tiles are taken back by the slide. They go to its glass too. `layout` changes when
 * the tiles may have moved inside a bar that kept its size.
 */
function useHitZone(ref: RefObject<HTMLDivElement | null>, shape: BarShape, setBoxes: Dispatch<SetStateAction<Box[]>>, layout: string, hold: { open: boolean; attention: boolean }) {
  const on = settings.use().taskbar.autoHide;
  const [band, setBand] = useState<Rect | null>(null);
  const down = useAutoHide({ band, ...hold });
  const menu = useRef<HitRect | null>(null);
  // As of the last render, for the reports the observers make.
  const now = useRef({ on, down });
  const report = useCallback(() => {
    const el = ref.current;
    if (!el || el.offsetWidth <= 0 || el.offsetHeight <= 0) return;
    const rest = boxOf(el);
    const box = { ...rest, h: window.innerHeight - rest.y };
    setBand((b) => (b?.x === box.x && b.y === box.y && b.w === box.w && b.h === box.h ? b : box));
    // The sliding layer inside the still box: how far down it is now, which the tiles' boxes give back.
    const layer = el.firstElementChild;
    const dy = layer ? layer.getBoundingClientRect().y - rest.y : 0;
    const tile = (t: Element) => {
      const b = boxOf(t);
      return { ...b, y: b.y - dy };
    };
    const groups = shape === "tiles" && layer ? [...layer.children].map((zone) => [...zone.querySelectorAll("[data-tile]")].map(tile)) : [[rest]];
    const bands = hitBoxes(groupBoxes(groups), window.innerHeight);
    void taskbar.hitRects(hitZones({ bands, open: menu.current ? [menu.current] : [], ...now.current, width: window.innerWidth, height: window.innerHeight }));
    const next = groups.flat();
    setBoxes((b) => (JSON.stringify(b) === JSON.stringify(next) ? b : next));
  }, [ref, shape, setBoxes]);
  useLayoutEffect(report, [report, layout]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(report);
    observer.observe(el);
    // A widget's tile changes width with what it shows (a temperature, a caption) inside a bar that keeps its size, moving its neighbours.
    if (shape === "tiles") el.querySelectorAll("[data-tile]").forEach((tile) => observer.observe(tile));
    // Another monitor or scale can move the bar without resizing it.
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [ref, report, shape, layout]);
  // Down or up, the option on or off: other zones over the same still box.
  useEffect(() => {
    now.current = { on, down };
    report();
  }, [on, down, report]);
  const place = useCallback(
    (box: HitRect | null) => {
      menu.current = box;
      report();
    },
    [report],
  );
  return { down, place };
}
