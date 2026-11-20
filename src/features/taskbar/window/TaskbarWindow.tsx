import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type Dispatch, type MouseEventHandler, type RefObject, type SetStateAction } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion } from "motion/react";
import { DotsThree } from "../../../ui/iconset";
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
import { PREVIEW_CLOSE, PREVIEW_DELAY, bridge, zones as hitZones, type Rect } from "../autoHide";
import { COMPACT_PAD, barButtons, clickAction, compactIcon, fitIcon, indicator, launchId, trayIcon, type BarButton, type BarItem, type BarShape, type Zone } from "../model";
import { barGap, groupBoxes, hitBoxes, itemGap, labelRise, tilePlaces, type Box } from "../look";
import { closePanel, itemDrag, panel, togglePanel } from "../panel";
import { dragThreshold, opensInBar } from "../panelModel";
import { barShown, barWindows, groupIcons } from "../store";
import { splitApps } from "../fit";
import { barStatus } from "../status";
import { batteryGlyph, netGlyph, soundGlyph } from "../statusModel";
import { trayFolded, trayState } from "../tray";
import { splitTray } from "../trayModel";
import { isTool, isWidget, shownZones, toolOf, widgetTool } from "../widgets";
import { toolInfo } from "../toolInfo";
import { useHue } from "../../themes/hues";
import { BarGlass, useBarSurface } from "./BarGlass";
import { Capsule } from "./Capsule";
import { AppsPanel } from "./AppsPanel";
import { AppMenu, BarMenu, CrestMenu, WindowList, type HitRect } from "./BarMenu";
import { BarPanel } from "./BarPanel";
import { holdBriefly } from "./hold";
import { Item, MARK, type ItemProps } from "./Item";
import { ItemDrop } from "./ItemDrop";
import { pressDragged, startPress } from "./press";
import { PreviewCard } from "./Preview";
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
/** The open preview card: the app's button, the span it opens over, CSS px, and whether a rest on the button or a click opened it. */
type Card = { key: string; x: number; w: number; by: "hover" | "click" };

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
  const s = settings.use();
  const { zones: saved, height, iconSize, pinned, shape, trayShown } = s.taskbar;
  // Without the buttons whose tool cannot open: the notch opens its first tool in place of one switched off there (widgets.ts toolShown).
  const zones = shownZones(saved, s.tools);
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
  // The pointer's x over the bar, Infinity off it: the magnified icons follow it without React drawing anything.
  const pointer = useMotionValue(Infinity);
  // Where the pointer last was over the bar, for the icons once a preview card stops holding them still.
  const lastX = useRef(Infinity);
  const [preview, setPreview] = useState<Card | null>(null);
  const card = useRef<Card | null>(null);
  // The apps' buttons by key, and the one timer of the card: the rest before it opens, or the wait before it closes.
  const appButtons = useRef(new Map<string, HTMLButtonElement>());
  const cardTimer = useRef<number | undefined>(undefined);
  // Every change of the card goes through here. Closing it or moving it to another app first takes its thumbnails away, so none
  // outlives its card; each call is the whole set, so the next card's slots replace this one in Rust. Nothing else clears them.
  const setCard = useCallback(
    (next: Card | null) => {
      window.clearTimeout(cardTimer.current);
      if (card.current && next?.key !== card.current.key) void taskbar.preview([]).catch(() => {});
      if (!next && card.current) pointer.set(lastX.current);
      card.current = next;
      setPreview(next);
    },
    [pointer],
  );
  const [menu, setOpenMenu] = useState<OpenMenu | null>(null);
  // The panel above the bar shares the menus' place in the hit zone: opening one closes the other. Every menu closes the panel here,
  // wherever it is set from, or one set while the panel is open would wait hidden behind it and pop up once it closes. A menu closes
  // the preview card too.
  const setMenu = useCallback(
    (next: OpenMenu | null) => {
      if (next) {
        closePanel();
        setCard(null);
      }
      setOpenMenu(next);
    },
    [setCard],
  );
  const closeMenu = useCallback(() => setMenu(null), [setMenu]);
  const open = panel.use();
  useEffect(() => {
    if (!open) return;
    setMenu(null);
    setCard(null);
  }, [open, setMenu, setCard]);
  // The item dragged along the bar, only its id: the pointer's moves would draw the whole bar again (ItemDrop follows them).
  const dragged = useSyncExternalStore(itemDrag.subscribe, () => itemDrag.get()?.id ?? null);
  // The shape's boxes, for its glass: new ones only when they change, so a hover does not draw the glass again.
  const [boxes, setBoxes] = useState<Box[]>([]);
  const reduced = useReducedMotion() === true;
  // Once the window lets the pointer through, the page sees no pointerleave: Rust says when the pointer left the bar.
  useEffect(
    () =>
      taskbar.onHover((inside) => {
        if (inside) return;
        setHovered(null);
        lastX.current = Infinity;
        setCard(null);
        pointer.set(Infinity);
      }),
    [pointer, setCard],
  );
  // The card closes when the bar hides, changes size or moves (a work area, a monitor rearranged): its thumbnails sit where its
  // boxes were. On unmount it takes them away, as a reload does at load (main.tsx).
  useEffect(() => {
    if (paused) setCard(null);
  }, [paused, setCard]);
  useEffect(() => {
    const close = () => setCard(null);
    window.addEventListener("resize", close);
    const moved = isNative ? getCurrentWebviewWindow().onMoved(close) : null;
    return () => {
      window.removeEventListener("resize", close);
      void moved?.then((off) => off());
      window.clearTimeout(cardTimer.current);
      void taskbar.preview([]).catch(() => {});
    };
  }, [setCard]);
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
  const between = itemGap(shape);
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
  // The card's app as it is now; its last window closed, or its button gone behind "…", the card goes.
  const cardButton = preview ? shownButtons.find((b) => b.key === preview.key && b.windows.length) : undefined;
  const cardEntry = cardButton && launchId(cardButton);
  const cardIcon = cardButton && (cardEntry ? icons[cardEntry] : ownIcons[cardButton.key]);
  const cardGone = preview !== null && !cardButton;
  const closeCard = useCallback(() => setCard(null), [setCard]);
  useEffect(() => {
    if (cardGone) setCard(null);
  }, [cardGone, setCard]);
  const narrow = fit.mode !== "full";
  const appIcon = narrow ? compactIcon(size) : size;
  const appWidth = narrow ? compactIcon(size) + COMPACT_PAD : undefined;
  useEffect(() => trayFolded.set(fit.trayBack), [fit.trayBack]);
  // Every app fits again: "…" goes, and so does its panel, which would stay open and empty.
  useEffect(() => {
    if (fit.mode !== "overflow" && panel.get()?.content.kind === "apps") closePanel();
  }, [fit.mode]);
  // Start, the apps, "…" and Crest grow as a dock's icons, by the pitch of the apps in use; widgets and tray icons only lift.
  const mag = reduced ? undefined : { pointer, unit: (narrow ? compactIcon(size) + COMPACT_PAD : size + 16) + between, rise: labelRise(size, height) };
  // The tiles' boxes move without the bar resizing when a button comes or goes, or the icons change size (a tile is size + 16 wide).
  // An open menu or panel holds the bar up, and so does an app asking for attention.
  const layout = `${buttons.map((b) => b.key)}|${JSON.stringify(zones)}|${size}|${trayVisible.map((i) => i.key)}|${fit.mode}:${fit.visible}:${fit.trayBack}:${fit.hide}|${glyphs}`;
  const { down, place: placeMenuZone, placePreview } = useHitZone(bar, shape, setBoxes, layout, {
    open: menu !== null || open !== null || preview !== null,
    attention: buttons.some((b) => indicator(b, active) === "attention"),
    dragging: dragged !== null,
  });
  // Down, Rust tells this bar, and the notch for the primary's, that it is hidden (bar.rs taskbar_slid): the widgets and their sources
  // rest as when it hides. Once per change, and once on load, which clears a slide the page left behind before a reload.
  useEffect(() => void taskbar.slid(down), [down]);
  // The card's box with its button's, so the gap between them keeps the pointer on the bar.
  const placeCard = useCallback(
    (box: HitRect | null) => {
      const button = card.current && appButtons.current.get(card.current.key);
      placePreview(box && button ? bridge(box, boxOf(button)) : box);
    },
    [placePreview],
  );
  // Slid off the screen, the bar runs no glass, as when it hides.
  const look = useBarSurface(boxes, down);
  // The shape slides out of its still box by its height and the gap under it, off the screen (useAutoHide).
  const slide = { initial: false, animate: { y: down ? height + gap : 0 }, transition: springs.snappy } as const;
  // In the order the tiles are drawn and measured: past LOOK.maxTiles the glass does not draw them, and they keep the veil. The tray
  // and Stato draw their tiles in their own render, and again alone, so they get places reserved here (tilePlaces).
  const take = tilePlaces();
  const tilesFor = (n: number) => {
    const glass = take(n);
    return (i: number) => (tiles ? { background: glass(i) ? look.background : look.plain, radius: look.radius } : undefined);
  };
  const tile = () => tilesFor(1)(0);

  /** Opens a menu over its button, or closes it on a second click there; another button's menu takes the place of an open one. */
  const toggle = (next: Menu, anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect();
    setMenu(menu?.kind === next.kind && menu.anchor === anchor ? null : { ...next, anchor, x: r.x, w: r.width });
  };
  const openCrestMenu: MouseEventHandler<HTMLButtonElement> = (e) => toggle({ kind: "crest" }, e.currentTarget);

  const launch = (b: BarButton, id: string) =>
    launcher.open(id).catch((code) => setError({ key: b.key, text: t(code === "not-found" ? "{name} ist nicht mehr installiert" : "{name} startet nicht", { name: b.name }) }));

  /** Opens the card over an app's button at once, by a rest on it or a click: its previews, its button's centre holding the icons still. */
  const openCard = (b: BarButton, by: Card["by"]) => {
    const r = appButtons.current.get(b.key)?.getBoundingClientRect();
    if (!r) return;
    pointer.set(r.x + r.width / 2);
    setCard({ key: b.key, x: r.x, w: r.width, by });
  };
  /** The pointer onto an app with windows: its card after a rest, or at once in place of another app's; nothing over a menu, the panel or a drag. */
  const showPreview = (b: BarButton) => {
    if (!b.windows.length || menu || open || dragged) return;
    window.clearTimeout(cardTimer.current);
    if (card.current?.key === b.key) return;
    if (card.current) return openCard(b, "hover");
    cardTimer.current = window.setTimeout(() => openCard(b, "hover"), PREVIEW_DELAY);
  };
  /** The pointer off the button or the card: a rest that has not opened one is dropped, an open card closes after a wait unless the pointer comes back. */
  const leavePreview = () => {
    window.clearTimeout(cardTimer.current);
    if (card.current)
      cardTimer.current = window.setTimeout(() => {
        // The click that opened it took the keyboard: left without a pick, it goes back to the app in front, as Esc gives it.
        if (card.current?.by === "click" && document.hasFocus()) void taskbar.release();
        setCard(null);
      }, PREVIEW_CLOSE);
  };

  /** A click on an app; `inPanel` for a cell of the "…" panel, which keeps the list of an app's windows. */
  const click = (b: BarButton, button: HTMLElement, inPanel = false) => {
    setError(null);
    const action = clickAction(b);
    if (action.kind === "list") {
      if (inPanel) return toggle({ kind: "list", b }, button);
      // A card the rest opened stays and becomes the click's, so resting then clicking keeps the previews; a second click closes it.
      const now = card.current;
      if (now?.key === b.key) return setCard(now.by === "click" ? null : { ...now, by: "click" });
      setMenu(null);
      closePanel();
      return openCard(b, "click");
    }
    setCard(null);
    setMenu(null);
    if (action.kind === "launch") launch(b, action.id);
    // A window of an app run as administrator may refuse; nothing changes then.
    else if (action.kind === "toggle") taskbar.window(action.id, "toggle").catch(() => {});
  };

  /** Opens `tool` over its button, or closes it on a second click there: in the panel, or in the notch for a tool the panel does not show (openPanel). */
  const openTool = (tool: string, button: HTMLElement) => {
    const r = button.getBoundingClientRect();
    togglePanel({ kind: "tool", tool }, { x: r.x, w: r.width });
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
    openTool(tool, button);
  };

  /**
   * A press on a widget, a tool button or Stato: past dragThreshold it drags the item along the bar (ItemDrop), closing the panel and
   * the menus and stopping the names and the magnifying for the drag.
   */
  const dragFrom =
    (id: BarItem): ItemProps["onPointerDown"] =>
    (e) =>
      startPress(e, {
        threshold: dragThreshold(e.pointerType),
        onDrag: (x, y) => {
          if (!itemDrag.get()) {
            closePanel();
            setMenu(null);
            setCard(null);
            setHovered(null);
            pointer.set(Infinity);
          }
          itemDrag.set({ id, x, y, pointerId: e.pointerId });
        },
        onEnd: () => itemDrag.set(null),
      });
  /** The click a drag's release makes; a key's click (no count) never ends a drag. */
  const afterDrag = (e: { detail: number }) => e.detail > 0 && pressDragged();

  const item = (key: string, name: string) => ({
    name,
    // An open menu or panel hides the names, which would show around it, and so does a drag.
    label: menu || open || dragged || preview ? null : error?.key === key ? error.text : hovered === key ? name : null,
    failed: error?.key === key,
    lifted: hovered === key,
    size,
    markAt,
    plus: look.look === "plus",
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
            // Over an app with windows the pointer also rests for its previews.
            onEnter={() => {
              setHovered(b.key);
              showPreview(b);
            }}
            onLeave={() => {
              setHovered((h) => (h === b.key ? null : h));
              leavePreview();
            }}
            ref={(el) => {
              if (el) appButtons.current.set(b.key, el);
              else appButtons.current.delete(b.key);
            }}
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
          onClick={(e) => afterDrag(e) || clickWidget(id, e.currentTarget)}
          onPointerDown={dragFrom(id)}
          // No menu of its own: the Crest menu over the pointer, as beside the buttons.
          onContextMenu={(e) => setMenu({ kind: "crest", anchor: null, x: e.clientX, w: 0 })}
        />
      );
    }
    if (isTool(id)) {
      // As a widget: on the primary bar only, and hidden once the bar runs out of room (useAppFit).
      if (!primary || fit.hide.includes(id)) return null;
      const tool = toolOf(id);
      return (
        <Item
          {...item(id, t(toolInfo[tool].label))}
          kind={id}
          tile={tile()}
          // A tray icon's slot, as the tray draws it.
          width={tiles ? undefined : trayIcon(size) + 16}
          // Only a tool the panel shows says whether it is open; one the notch opens leaves the bar's panel closed.
          expanded={opensInBar({ kind: "tool", tool }) ? open?.content.kind === "tool" && open.content.tool === tool : undefined}
          onClick={(e) => {
            if (afterDrag(e)) return;
            setError(null);
            setMenu(null);
            openTool(tool, e.currentTarget);
          }}
          onPointerDown={dragFrom(id)}
          // No menu of its own, as a widget: the Crest menu over the pointer.
          onContextMenu={(e) => setMenu({ kind: "crest", anchor: null, x: e.clientX, w: 0 })}
        >
          <ToolGlyph tool={tool} size={trayIcon(size)} plus={look.look === "plus"} />
        </Item>
      );
    }
    if (id === "tray") {
      const visible = fit.trayBack ? [] : trayVisible;
      return (
        <Tray
          visible={visible}
          size={size}
          item={item}
          // Its icons, then ^.
          tile={tilesFor(visible.length + 1)}
          tiles={tiles}
          more={trayMore}
          // No menu of its own, as a widget: the Crest menu over the pointer.
          onMenu={(e) => setMenu({ kind: "crest", anchor: null, x: e.clientX, w: 0 })}
        />
      );
    }
    if (id === "status")
      return (
        <Status
          size={size}
          height={height}
          item={item}
          // Its tile, or none while it shows no glyph and draws nothing.
          tile={tilesFor(glyphs ? 1 : 0)}
          expanded={open?.content.kind === "quick"}
          onClick={(e) => {
            if (afterDrag(e)) return;
            setError(null);
            setMenu(null);
            const r = e.currentTarget.getBoundingClientRect();
            togglePanel({ kind: "quick" }, { x: r.x, w: r.width });
          }}
          onPointerDown={dragFrom(id)}
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

  /** Each item in a box-less span the drop measures it by (ItemDrop); the draggable ones keep touch for the drag, the dragged one dims. */
  const place = (id: BarItem) => (
    <span key={id} data-item={id} className={`contents ${isWidget(id) || isTool(id) || id === "status" ? "*:touch-none" : ""} ${dragged === id ? "*:opacity-40" : ""}`}>
      {render(id)}
    </span>
  );

  return (
    <div
      // Clipped, so the bar slid off the screen leaves #root nothing to scroll to when one of its buttons takes the focus.
      className="flex h-full flex-col justify-end overflow-clip"
      style={{ ["--accent" as string]: accent }}
      // A right click during a drag opens nothing, on any button or beside them.
      onContextMenuCapture={(e) => {
        if (!itemDrag.get()) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      // A right click beside the buttons, on the bar or in the gap under it: the Crest menu, over the pointer. Not in the panel.
      onContextMenu={(e) => {
        if ((e.target as Element).closest("button, [role=menu], [role=dialog]")) return;
        setMenu({ kind: "crest", anchor: null, x: e.clientX, w: 0 });
      }}
    >
      {/* On the closed notch's black, and always under Liquid Glass +, the bar and its menus keep the closed notch's ink whatever the theme (useBarSurface), and its zones keep their sides in any language. */}
      <div data-theme-ink dir="ltr" className="contents" style={look.ink}>
        {look.glass && <BarGlass {...look.glass} />}
        {/* The shape's place stays still, so its box is the band at rest while the shape slides out of it (useHitZone measures this box). */}
        <div
          ref={bar}
          className={shape === "capsule" ? "self-center" : undefined}
          style={{ margin: shape === "capsule" ? `0 0 ${gap}px` : `0 ${gap}px ${gap}px` }}
          // The bar only, never a menu or the panel above it.
          // Not while dragging: no icon grows under the ghost.
          // Nor while a preview card is open: the icons hold still round its button.
          onPointerMove={(e) => {
            lastX.current = e.clientX;
            if (!itemDrag.get() && !card.current) pointer.set(e.clientX);
          }}
          onPointerLeave={() => {
            lastX.current = Infinity;
            if (!card.current) pointer.set(Infinity);
          }}
        >
          {/* Positioned, so it draws over the glass's canvas. The capsule puts the three zones in a row, as close as its buttons. */}
          {shape === "capsule" ? (
            <motion.div {...slide}>
              <Capsule style={{ height, borderRadius: look.radius, background: look.background }} gap={between}>
                {ZONES.map(([zone]) => zones[zone].map(place))}
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
                <div key={zone} data-zone={zone} className={`flex ${justify} ${zone !== "center" && zones[zone].includes("apps") ? "" : "min-w-0"}`} style={{ gap: between }}>
                  {zones[zone].map(place)}
                </div>
              ))}
            </motion.div>
          )}
        </div>
        {/* In the bar's ink, so the ghost has the bar's colours. */}
        <ItemDrop bar={bar} size={trayIcon(size)} gap={between} />
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
        {/* In the bar's ink as the menus, so Liquid Glass +'s dark ink reaches it too; never over a menu or the panel. */}
        <AnimatePresence>
          {preview && cardButton && !menu && !open && (
            <PreviewCard
              key={preview.key}
              b={cardButton}
              icon={cardIcon}
              x={preview.x}
              w={preview.w}
              bottom={gap + height + MENU_GAP}
              by={preview.by}
              anchor={appButtons.current.get(preview.key) ?? null}
              onPlace={placeCard}
              onEnter={() => window.clearTimeout(cardTimer.current)}
              onLeave={leavePreview}
              onClose={closeCard}
            />
          )}
        </AnimatePresence>
      </div>
      {/* Outside the bar's ink, which would lay an Arabic panel out left to right: the panel has the theme's colours whatever the bar's
          background, as the notch's open panel has, and under Liquid Glass + the bar's ink and a rim light (useBarSurface). */}
      <BarPanel
        bar={bar}
        surface={look.panel}
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
                click(b, cell, true);
              }}
              onMenu={(b, cell) => toggle({ kind: "app", b }, cell)}
            />
          ),
        }}
      />
      <TrayDrop bar={bar} more={trayMore} size={trayIcon(size)} gap={between} />
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
function useHitZone(
  ref: RefObject<HTMLDivElement | null>,
  shape: BarShape,
  setBoxes: Dispatch<SetStateAction<Box[]>>,
  layout: string,
  hold: { open: boolean; attention: boolean; dragging: boolean },
) {
  const on = settings.use().taskbar.autoHide;
  const [band, setBand] = useState<Rect | null>(null);
  // A drag keeps the bar up.
  const down = useAutoHide({ band, open: hold.open || hold.dragging, attention: hold.attention });
  const menu = useRef<HitRect | null>(null);
  // The preview card's zone, in a ref beside the menus': the panel closing would overwrite theirs.
  const preview = useRef<HitRect | null>(null);
  // While an item is dragged the whole window, in a ref of its own: a closing panel overwrites the menus' one.
  const drag = useRef(false);
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
    const open = [...(menu.current ? [menu.current] : []), ...(preview.current ? [preview.current] : []), ...(drag.current ? [{ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }] : [])];
    void taskbar.hitRects(hitZones({ bands, open, ...now.current, width: window.innerWidth, height: window.innerHeight }));
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
  useLayoutEffect(() => {
    drag.current = hold.dragging;
    report();
  }, [hold.dragging, report]);
  const place = useCallback(
    (box: HitRect | null) => {
      menu.current = box;
      report();
    },
    [report],
  );
  const placePreview = useCallback(
    (box: HitRect | null) => {
      preview.current = box;
      report();
    },
    [report],
  );
  return { down, place, placePreview };
}

/**
 * A tool button's icon: the widgets' resting colour (Widget.tsx), or the tool's hue with coloured icons on, as the notch's Dock draws
 * it. Under Liquid Glass +, beside the apps' white icons, it rests as the Dock's icons do (DockButton's text-label-2), not switched off.
 */
function ToolGlyph({ tool, size, plus }: { tool: string; size: number; plus: boolean }) {
  const I = toolInfo[tool].icon;
  return <I size={size} weight="regular" className={plus ? "text-label-2" : "text-label-3"} style={{ color: useHue(toolInfo[tool].hue) }} />;
}
