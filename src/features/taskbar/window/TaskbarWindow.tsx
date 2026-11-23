import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type Dispatch, type DragEvent, type MouseEventHandler, type RefObject, type SetStateAction } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion } from "motion/react";
import { DotsThree, SquaresFour } from "../../../ui/iconset";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { design } from "../../../design/design";
import { springs } from "../../../design/motion";
import { t } from "../../../i18n";
import { partInfo } from "../../../notch/row/partInfo";
import type { PartId } from "../../../notch/row/parts";
import { isNative } from "../../../platform/native";
import { postFiles } from "../../../platform/drop";
import { launcher, systemControls, taskbar } from "../../../platform/services";
import { settings } from "../../../settings/store";
import { CrestMark } from "../../../ui/CrestMark";
import { AppIcon } from "../../launcher/AppIcon";
import { useIcons } from "../../launcher/store";
import { useThemedAccent } from "../../themes/store";
import { convertMode } from "../../convert/mode";
import { awakeOn } from "../../overview/awake";
import { awake, startAwake, stopAwake } from "../../overview/store";
import { stepWallpaper } from "../../wallpapers/store";
import { stopwatchActions, timerTab } from "../../timer/store";
import { PREVIEW_CLOSE, PREVIEW_DELAY, bridge, zones as hitZones, type Rect } from "../autoHide";
import { COMPACT_PAD, DRAG_REST, shiftMenu, WHEEL_STEP, appKey, appState, barArrow, barButtons, buttonAt, clickAction, cycleKey, numberKey, compactIcon, fitIcon, indicator, insertPinned, labelSpan, launchId, trayIcon, wheelSteps, windowBadge, windowButtons, type BarButton, type BarEdge, type BarItem, type BarKey, type BarShape, type Click, type ClickMods, type Zone } from "../model";
import { barGap, groupBoxes, hitBoxes, itemGap, labelRise, tilePlaces, type Box } from "../look";
import { barMargin, slideBy, toEdge } from "../position";
import { BarEdgeContext, barEdgeNow } from "./barEdge";
import { StartMark } from "./StartMark";
import { closePanel, fileDrag, itemDrag, panel, pinDrag, quickPage, togglePanel } from "../panel";
import { dragThreshold, folderCols, opensInBar } from "../panelModel";
import { folderKey, normalizeFolders, pinBefore } from "../folderModel";
import { barShown, barWindows, groupIcons, setTaskbar } from "../store";
import { splitApps } from "../fit";
import { barStatus } from "../status";
import { batteryGlyph, netGlyph, soundGlyph } from "../statusModel";
import { barDecor, decorPictures, trayFolded, trayState } from "../tray";
import { buttonDecor, type Progress } from "../decorModel";
import type { FaceKey } from "../faceKeys";
import { splitTray } from "../trayModel";
import { hasWidgetMenu, isSys, isTool, isWidget, shownZones, sysOf, sysPrimaryOnly, toolOf, trashable, weatherWanted, widgetPanel, widgetScale, widgetTool } from "../widgets";
import { toolInfo } from "../toolInfo";
import { useHue } from "../../themes/hues";
import { BarGlass, useBarSurface } from "./BarGlass";
import { Capsule } from "./Capsule";
import { AppsPanel, FolderIcon } from "./AppsPanel";
import { AppMenu, BarMenu, CrestMenu, FolderMenu, GroupMenu, MoveMenu, RecycleMenu, WindowList, WindowMenu, closeWindows, type HitRect } from "./BarMenu";
import { BarPanel } from "./BarPanel";
import { dropStaleScan } from "./DisksPanel";
import { FolderPanel } from "./FolderPanel";
import { holdBriefly } from "./hold";
import { Item, type ItemProps } from "./Item";
import { markThick } from "../itemLook";
import { ItemDrop } from "./ItemDrop";
import { runFaceKey } from "./MediaFaces";
import { PinDrop, placeAt } from "./PinDrop";
import { pressDragged, startPress } from "./press";
import { PreviewCard } from "./Preview";
import { RecentMenu } from "./RecentMenu";
import { Status } from "./Status";
import { SYS_INFO, SysButton } from "./SysItems";
import { Tray, TrayDrop, trayLeave } from "./Tray";
import { openUnread } from "./UnreadFaces";
import { useAppFit } from "./useAppFit";
import { useAutoHide } from "./useAutoHide";
import { WidgetItem } from "./Widget";
import { WidgetMenu } from "./WidgetMenu";

/** Room between the bar and a menu above it, CSS px, as between a button and its name. */
const MENU_GAP = 8;
const ZONES: [Zone, string][] = [
  ["left", "justify-start"],
  ["center", "justify-center"],
  ["right", "justify-end"],
];
/** The primary bar, the window labelled `taskbar`: only it draws widgets and follows the notch (main.tsx); the bars on other monitors skip both. */
export const primary = !isNative || getCurrentWebviewWindow().label === "taskbar";

/**
 * What a menu lists: an app's right-click menu, an app's windows (as they were when it opened), its window's or its group's, Move to
 * folder's, a folder's own, the Crest menu, the Recycle Bin's, the files opened last or a widget's own.
 */
type Menu = { kind: "app" | "list" | "window" | "group" | "move" | "folder"; b: BarButton } | { kind: "crest" } | { kind: "recycle" } | { kind: "recent" } | { kind: "widget"; id: PartId };
/** An open menu, the button it opened from (null: a right click beside the buttons) and the span it opens over, CSS px. */
type OpenMenu = Menu & { anchor: Element | null; x: number; w: number };
/** The open preview card: the app's button, the span it opens over, CSS px, and whether a rest on the button or a click opened it. */
type Card = { key: string; x: number; w: number; by: "hover" | "click" };
/** The menu a right click opens on an app's button or cell: a folder's own, with Shift its window's or its group's (shiftMenu), else the app's. */
const menuKind = (b: BarButton, shift: boolean) => (shift || b.folder ? shiftMenu(b) : "app");

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
  const { zones: saved, height, iconSize, pinned, shape, trayShown, combine, flashing, middleClick, windowCount, wheelVolume, marks, startIcon } = s.taskbar;
  // The site's demo lays the bar over its own page and keeps the bottom.
  const edge = barEdgeNow();
  // Without the buttons whose tool cannot open: the notch opens its first tool in place of one switched off there (widgets.ts toolShown).
  const zones = shownZones(saved, s.tools);
  const { visible: trayVisible } = splitTray(trayState.use().icons, trayShown);
  const { groups, active } = barWindows.use();
  const decor = barDecor.use();
  const decorPics = decorPictures.use();
  const accent = useThemedAccent(undefined);
  // Rust hides the window without telling WebView2 the page is out of sight, so the widgets rest by this instead. It reads false
  // while the bar is slid off the screen too (taskbar.slid below).
  const paused = !barShown.use();
  const bar = useRef<HTMLDivElement>(null);
  // The tray's ^ button: a tray icon dragged onto the bar lands between the first kept icon and it.
  const trayMore = useRef<HTMLButtonElement>(null);
  // The apps' "…" button: Win+number on an app behind it opens over it.
  const appsMore = useRef<HTMLButtonElement>(null);
  // The keyboard is in the bar after one of its Windows keys, Tab or an arrow (not after a click): it holds a bar that slides away up.
  const keyNav = useRef(false);
  const [focusIn, setFocusIn] = useState(false);
  // The button under the pointer, and a launch that failed (in its button's label for a while).
  const [hovered, setHovered] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(null);
  // An app's new volume after a wheel step, in its button's label for a moment.
  const [note, setNote] = useState<{ key: string; text: string } | null>(null);
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
  // The pinned app dragged along the bar, by its pin id, for the same reason (PinDrop follows it).
  const pinDragged = useSyncExternalStore(pinDrag.subscribe, () => pinDrag.get()?.id ?? null);
  const dragging = dragged !== null || pinDragged !== null;
  // Where the last files dropped on the apps go once Rust has pinned those that are apps: before this pin, or at the end with null.
  const dropBefore = useRef<string | null>(null);
  useEffect(
    () =>
      taskbar.onPinned((apps) =>
        setTaskbar((t) => ({ pinned: insertPinned(t.pinned ?? [], apps, pinBefore({ pinned: t.pinned ?? [], folders: normalizeFolders(t.folders, t.pinned) }, dropBefore.current)) })),
      ),
    [],
  );
  // The shape's boxes, for its glass: new ones only when they change, so a hover does not draw the glass again.
  const [boxes, setBoxes] = useState<Box[]>([]);
  const reduced = useReducedMotion() === true;
  // Once the window lets the pointer through, the page sees no pointerleave: Rust says when the pointer left the bar.
  useEffect(
    () =>
      taskbar.onHover((inside) => {
        if (inside) return;
        // No pointerleave reaches a click-through window: a tray icon's app hears the leave here.
        trayLeave();
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
  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 1500);
    return () => window.clearTimeout(id);
  }, [note]);

  // Repaired on every draw, as nothing repairs the settings during a session (settings/store.ts), and named.
  // shortcut: an app unpinned leaves its folder only as drawn; its id stays saved until the next start or folder change, so one pinned
  // again meanwhile is back in its folder. Fine unless that surprises someone; then drop it from the folders where it is unpinned.
  const folders = normalizeFolders(s.taskbar.folders, pinned).map((f) => ({ ...f, name: f.name || t("Ordner") }));
  const buttons = barButtons(pinned, groups, folders);
  const perWindow = combine === "always" ? buttons : windowButtons(buttons);
  const icons = useIcons(buttons.flatMap((b) => (b.folder ? b.folder.apps.flatMap((a) => launchId(a) ?? []) : (launchId(b) ?? []))));
  const ownIcons = groupIcons.use();
  const size = fitIcon(height, iconSize);
  // The mark sits in the middle of the room under the icon, on whole pixels.
  const markAt = Math.round(((height - size) / 2 - markThick(marks)) / 2);
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
  const fit = useAppFit(bar, {
    zones,
    shape,
    size,
    scale: widgetScale(height, iconSize, s.taskbar.widgetSize),
    count: buttons.length,
    trayCount: trayVisible.length,
    primary,
    clockAll: s.taskbar.clockAll,
    glyphs,
    split: combine === "always" ? null : { count: perWindow.length, titled: perWindow.filter((b) => b.title !== undefined).length, ...labelSpan(size), never: combine === "never" },
  });
  // The buttons as drawn: one per window while the fit says so.
  const laid = fit.split ? perWindow : buttons;
  const kept = [...laid.filter((b) => b.windows.some((w) => w.id === active)), ...laid.filter((b) => indicator(b, active, flashing) === "attention")].map((b) => b.key);
  const shown = new Set(splitApps(laid.map((b) => b.key), fit.mode === "overflow" ? fit.visible : laid.length, kept).shown);
  const shownButtons = laid.filter((b) => shown.has(b.key));
  const hiddenButtons = laid.filter((b) => !shown.has(b.key));
  // The card's app as it is now; its last window closed, or its button gone behind "…", the card goes.
  const cardButton = preview ? shownButtons.find((b) => b.key === preview.key && b.windows.length) : undefined;
  const cardEntry = cardButton && launchId(cardButton);
  const cardIcon = cardButton && (cardEntry ? icons[cardEntry] : ownIcons[appKey(cardButton)]);
  const cardGone = preview !== null && !cardButton;
  const closeCard = useCallback(() => setCard(null), [setCard]);
  useEffect(() => {
    if (cardGone) setCard(null);
  }, [cardGone, setCard]);
  const narrow = fit.mode === "compact" || fit.mode === "overflow";
  // Each window's button with its title, as wide as the fit gives them; a pinned app with no window keeps its icon's width.
  const titled = fit.mode === "labels";
  const appIcon = narrow ? compactIcon(size) : size;
  const appWidth = narrow ? compactIcon(size) + COMPACT_PAD : undefined;
  useEffect(() => trayFolded.set(fit.trayBack), [fit.trayBack]);
  // Every app fits again: "…" goes, and so does its panel, which would stay open and empty.
  useEffect(() => {
    if (fit.mode !== "overflow" && panel.get()?.content.kind === "apps") closePanel();
  }, [fit.mode]);
  // The same for the hidden widgets' button and its panel, which shows them in the bar's order.
  const hidden = ZONES.flatMap(([z]) => zones[z]).filter((id) => fit.hide.includes(id));
  useEffect(() => {
    if (!hidden.length && panel.get()?.content.kind === "widgets") closePanel();
  }, [hidden.length]);
  // The open folder, and with it gone (ungrouped on another bar, its last app unpinned) its panel.
  const folderId = open?.content.kind === "folder" ? open.content.id : null;
  const folderFocus = open?.content.kind === "folder" ? open.content.focus : undefined;
  const openedFolder = folderId === null ? undefined : buttons.find((b) => b.folder?.id === folderId);
  const folderGone = folderId !== null && !openedFolder;
  useEffect(() => {
    if (folderGone) closePanel();
  }, [folderGone]);
  // Start, the apps, "…", Crest and Windows' buttons grow as a dock's icons, by the pitch of the apps in use; widgets and tray icons only lift.
  const mag = reduced ? undefined : { pointer, unit: (narrow ? compactIcon(size) + COMPACT_PAD : size + 16) + between, rise: labelRise(size, height) };
  // The tiles' boxes move without the bar resizing when a button comes or goes, or the icons change size (a tile is size + 16 wide).
  // An open menu or panel holds the bar up, and so does an app asking for attention.
  const layout = `${laid.map((b) => b.key)}|${JSON.stringify(zones)}|${size}|${trayVisible.map((i) => i.key)}|${fit.mode}:${fit.visible}:${fit.trayBack}:${fit.hide}|${glyphs}`;
  const { down, place: placeMenuZone, placePreview } = useHitZone(bar, shape, edge, setBoxes, layout, {
    open: menu !== null || open !== null || preview !== null || focusIn,
    attention: buttons.some((b) => indicator(b, active, flashing) === "attention"),
    dragging,
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
  const appDesign = design.use();
  // The shape slides out of its still box by its height and the gap at the edge, off the screen (useAutoHide).
  const slide = { initial: false, animate: { y: down ? slideBy(edge, height + gap) : 0 }, transition: springs.snappy } as const;
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

  /** Opens the card over an app's button at once, by a rest on it or a click: its previews, its button's centre holding the icons still. */
  const openCard = (b: BarButton, by: Card["by"]) => {
    const r = appButtons.current.get(b.key)?.getBoundingClientRect();
    if (!r) return;
    pointer.set(r.x + r.width / 2);
    setCard({ key: b.key, x: r.x, w: r.width, by });
  };
  /** The pointer onto an app with windows: its card after a rest, or at once in place of another app's; nothing over a menu, the panel or a drag. */
  const showPreview = (b: BarButton) => {
    if (!b.windows.length || menu || open || dragging) return;
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

  /** Runs click `c` on app `b`; `cell` for a cell of the "…" panel, which keeps the list of an app's windows. */
  const run = (b: BarButton, c: Click, cell?: HTMLElement) => {
    if (c.kind === "folder") return b.folder && openFolder(b.folder.id);
    if (c.kind === "list") {
      if (cell) return toggle({ kind: "list", b }, cell);
      // A card the rest opened stays and becomes the click's, so resting then clicking keeps the previews; a second click closes it.
      const now = card.current;
      if (now?.key === b.key) return setCard(now.by === "click" ? null : { ...now, by: "click" });
      setMenu(null);
      closePanel();
      return openCard(b, "click");
    }
    setCard(null);
    setMenu(null);
    // A declined administrator prompt is no error; "not-found" from a window means only that it closed meanwhile.
    const failed = (code: unknown) => {
      if (code !== "cancelled") setError({ key: b.key, text: t(c.kind === "launch" && code === "not-found" ? "{name} ist nicht mehr installiert" : "{name} startet nicht", { name: b.name }) });
    };
    if (c.kind === "launch") launcher.open(c.id, c.admin === true).catch(failed);
    else if (c.kind === "spawn") taskbar.launchWindow(c.id, c.admin === true).catch(failed);
    // A window of an app run as administrator may refuse; nothing changes then.
    else if (c.kind === "toggle" || c.kind === "activate") taskbar.window(c.id, c.kind).catch(() => {});
    else if (c.kind === "closeAll") closeWindows(b);
  };
  /** A file held over an app (K1): after DRAG_REST its one window comes forward, or its previews open for several. */
  const dragTimer = useRef<number | undefined>(undefined);
  const dragRest = (b: BarButton): Pick<ItemProps, "onDragEnter" | "onDragLeave"> => ({
    onDragEnter: () => {
      window.clearTimeout(dragTimer.current);
      dragTimer.current = window.setTimeout(() => {
        if (b.windows.length === 1) void taskbar.window(b.windows[0].id, "activate").catch(() => {});
        else if (b.windows.length > 1) openCard(b, "hover");
      }, DRAG_REST);
    },
    // Into the icon inside the same button is no leave.
    onDragLeave: (e) => {
      if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) window.clearTimeout(dragTimer.current);
    },
  });
  /**
   * The wheel on the bar (J4): over Stato Windows' volume always; with the switch on, over an app that app's own, elsewhere Windows'.
   * The notches add up per target, and the steps run one after the other so none reads a level another is about to change.
   */
  const wheel = useRef({ target: "", rest: 0, queue: Promise.resolve() });
  const onWheel = (e: { target: EventTarget; deltaY: number }) => {
    const el = e.target as Element;
    const app = laid.find((b) => appButtons.current.get(b.key)?.contains(el));
    const status = el.closest('[data-kind="status"]') !== null;
    if (!status && !wheelVolume) return;
    const target = app && !status ? app.key : "windows";
    if (wheel.current.target !== target) wheel.current = { ...wheel.current, target, rest: 0 };
    const { steps, rest } = wheelSteps(wheel.current.rest, e.deltaY);
    wheel.current.rest = rest;
    if (!steps) return;
    const step = (steps * WHEEL_STEP) / 100;
    const win = app && (app.windows.find((w) => w.id === active) ?? app.windows[0]);
    wheel.current.queue = wheel.current.queue.then(async () => {
      if (target === "windows") {
        const v = await systemControls.volume();
        await systemControls.setVolume({ level: Math.min(1, Math.max(0, v.level + step)) });
      } else if (app && win) {
        const n = await taskbar.appVolume(win.id, step);
        setNote({ key: app.key, text: n === null ? t("{name} spielt keinen Ton ab", { name: app.name }) : t("Lautstärke: {n} %", { n }) });
      }
    }).catch(() => {});
  };
  /** A click on an app, with the keys held; `inPanel` for a cell of the "…" panel or of a folder's. */
  const click = (b: BarButton, button: HTMLElement, inPanel = false, mods: ClickMods = {}) => {
    setError(null);
    run(b, clickAction(b, mods, { active, middle: middleClick }), inPanel ? button : undefined);
  };
  /**
   * Opens folder `id` in the panel over its button, over "…" while it is behind it, or closes it on a second click there; `focus` puts the
   * keyboard on its first app or in its name's field.
   */
  const openFolder = (id: string, focus?: "first" | "name") => {
    const over = appButtons.current.get(folderKey(id)) ?? appsMore.current;
    if (!over) return;
    setError(null);
    const r = over.getBoundingClientRect();
    togglePanel({ kind: "folder", id, ...(focus && { focus }) }, { x: r.x, w: r.width });
  };
  // A folder made from Move to folder opens once it is drawn, with its name ready to type.
  const fresh = useRef<string | null>(null);
  useEffect(() => {
    const id = fresh.current;
    if (id === null || !buttons.some((b) => b.folder?.id === id)) return;
    fresh.current = null;
    openFolder(id, "name");
  });

  /**
   * A Windows key Rust sent this bar (keys.rs). Win+number counts every app button, those behind "…" too: it acts as a click, and
   * the previews, the menu or the folder it opens take the keyboard. Win+T goes round the apps' buttons, Win+B to the tray's ^ (Stato
   * without it).
   */
  const onKey = async (k: BarKey) => {
    keyNav.current = true;
    if (k.kind === "number") {
      const b = buttonAt(laid, k.n);
      const c = numberKey(b, k.mods, active);
      if (!b || c.kind === "none") return;
      if (c.kind !== "list" && c.kind !== "menu" && c.kind !== "folder") return run(b, c);
      await taskbar.focus().catch(() => {});
      if (b.folder && c.kind === "folder") return openFolder(b.folder.id, "first");
      const el = appButtons.current.get(b.key);
      const over = el ?? appsMore.current;
      if (!over) return;
      if (c.kind === "menu") return toggle({ kind: menuKind(b, false), b }, over);
      return el ? run(b, c) : toggle({ kind: "list", b }, over);
    }
    await taskbar.focus().catch(() => {});
    const target =
      k.kind === "apps"
        ? (() => {
            const all = [...shownButtons.flatMap((b) => appButtons.current.get(b.key) ?? []), ...(appsMore.current ? [appsMore.current] : [])];
            return all[cycleKey(all.indexOf(document.activeElement as HTMLButtonElement), all.length, k.by)];
          })()
        : (trayMore.current ?? bar.current?.querySelector<HTMLElement>('[data-kind="status"]'));
    if (target) target.focus({ preventScroll: true });
    else void taskbar.release();
  };
  const keyHandler = useRef(onKey);
  useEffect(() => {
    keyHandler.current = onKey;
  });
  useEffect(() => taskbar.onKey((k) => void keyHandler.current(k)), []);

  /**
   * The span on the bar a panel opens over, which BarPanel reads as the item it opened from: the button's own, or for a hidden item's
   * cell, which sits in the hidden items' panel, the span of the button that shows them.
   */
  const spanOf = (button: HTMLElement) => {
    const on = bar.current?.contains(button) ? button : (bar.current?.querySelector<HTMLElement>('[data-kind="widgets-more"]') ?? button);
    const r = on.getBoundingClientRect();
    return { x: r.x, w: r.width };
  };

  /** Opens `tool` over its button, or closes it on a second click there: in the panel, or in the notch for a tool the panel does not show (openPanel). */
  const openTool = (tool: string, button: HTMLElement) => togglePanel({ kind: "tool", tool }, spanOf(button));

  /** The search box's field, in the panel over its button. */
  const openSearch = (button: HTMLElement) => {
    setError(null);
    togglePanel({ kind: "search" }, spanOf(button));
  };

  /**
   * A widget opens its tool in the panel over it, or a panel of the bar's own (widgets.ts widgetPanel): the disk widget its drives, the
   * main bar's clock, the time progress and the date Crest's Notices over its Calendar, the crypto widget its coin's week, Device
   * batteries the quick panel's Bluetooth page. On the other bars, which get no notices or calendar from the notch, the clock opens
   * Windows' notification centre, as Windows' own clock does. Unread opens the app under the pointer (`slot`) or the one in front. A
   * click on a key of its face (`key`) does what the key does, and so does every click on the microphone; a wallpaper step that fails
   * opens Wallpapers. The stopwatch's click starts or pauses it, Keep awake's turns it on until turned off or off. The timer opens the
   * Timer on its countdown, the exchange rate the Converter on its currencies. On the main bar the weather of the clock's Time and
   * weather and of the date's week opens Weather; on the other bars the whole clock does as before.
   */
  const clickWidget = (id: PartId, button: HTMLElement, key: FaceKey | null, slot: number | null = null) => {
    setError(null);
    setMenu(null);
    if (id === "unread") return openUnread(slot);
    if (key === "wallPrevious" || key === "wallNext") return void stepWallpaper(key === "wallNext" ? 1 : -1).catch(() => openTool("wallpapers", button));
    if (key === "weather") {
      if (primary) return openTool("weather", button);
    } else if (key || id === "mic") return runFaceKey(key ?? "mic", (text) => setError({ key: id, text }));
    if (id === "stopwatch") return stopwatchActions.toggle();
    if (id === "keepawake") return awakeOn(awake.get(), Date.now()) ? stopAwake() : startAwake(null);
    const own = widgetPanel(id, primary);
    if (own) {
      // Not on the click that closes it, or the closing panel would turn into the drives, or to its Bluetooth page, as it fades.
      if (own === "disks" && panel.get()?.content.kind !== "disks") dropStaleScan();
      if (own === "quick" && panel.get()?.content.kind !== "quick") quickPage.set({ page: "bluetooth", rows: 1, extra: 0 });
      return togglePanel({ kind: own }, spanOf(button));
    }
    const tool = widgetTool(id);
    // Windows may refuse to open it; nothing changes then. The bar stays up while it comes to the front.
    if (tool === null) {
      holdBriefly();
      return void taskbar.calendar().catch(() => {});
    }
    if (id === "timer") timerTab.set("timer");
    if (id === "currency") convertMode.set("currency");
    openTool(tool, button);
  };

  /**
   * A press on a widget, a tool button, Stato or a pinned app: past dragThreshold it drags along the bar (`move` gets each move, `end`
   * the release), closing the panel and the menus and stopping the names and the magnifying for the drag.
   */
  const dragPress = (e: Parameters<typeof startPress>[0], move: (x: number, y: number) => void, end: () => void) => {
    let first = true;
    startPress(e, {
      threshold: dragThreshold(e.pointerType),
      onDrag: (x, y) => {
        if (first) {
          first = false;
          closePanel();
          setMenu(null);
          setCard(null);
          setHovered(null);
          pointer.set(Infinity);
        }
        move(x, y);
      },
      onEnd: end,
    });
  };
  /** A widget, a tool button, a Windows button, Stato or the Crest button dragged (ItemDrop). */
  const dragFrom =
    (id: BarItem): ItemProps["onPointerDown"] =>
    (e) =>
      dragPress(e, (x, y) => itemDrag.set({ id, x, y, pointerId: e.pointerId }), () => itemDrag.set(null));
  /** A pinned app dragged among the pinned ones (PinDrop), by its pin: a split button's key names a window, its pin the app. */
  const dragPin = (pin: string, e: Parameters<typeof startPress>[0]) =>
    dragPress(e, (x, y) => pinDrag.set({ id: pin, x, y, pointerId: e.pointerId }), () => pinDrag.set(null));
  /** The click a drag's release makes; a key's click (no count) never ends a drag. */
  const afterDrag = (e: { detail: number }) => e.detail > 0 && pressDragged();

  const item = (key: string, name: string) => ({
    name,
    // An open menu or panel hides the names, which would show around it, and so does a drag.
    label: menu || open || dragging || preview ? null : error?.key === key ? error.text : note?.key === key ? note.text : hovered === key ? name : null,
    failed: error?.key === key,
    lifted: hovered === key,
    size,
    markAt,
    plus: look.look === "plus",
    onEnter: () => setHovered(key),
    onLeave: () => setHovered((h) => (h === key ? null : h)),
  });

  /**
   * The button in the first hidden item's place, the outermost: the widgets, tool buttons and Windows buttons the bar has no room for, in
   * rows in the panel over it. Its width is the one the fit charges (useAppFit).
   */
  const moreButton = () => {
    const n = fit.hide.length;
    return (
      <Item
        {...item("widgets-more", t(n === 1 ? "{n} weiteres Widget" : "{n} weitere Widgets", { n }))}
        kind="widgets-more"
        tile={tile()}
        width={tiles ? undefined : trayIcon(size) + 16}
        expanded={open?.content.kind === "widgets"}
        onClick={(e) => {
          setError(null);
          setMenu(null);
          const r = e.currentTarget.getBoundingClientRect();
          togglePanel({ kind: "widgets" }, { x: r.x, w: r.width });
        }}
        // No menu of its own, as ^ and "…": the Crest menu over the pointer.
        onContextMenu={(e) => setMenu({ kind: "crest", anchor: null, x: e.clientX, w: 0 })}
      >
        <SquaresFour size={trayIcon(size)} weight="regular" />
      </Item>
    );
  };

  // Each item draws in a branch of its own: an item added to BarItem without one is a type error, not a second Crest button. `free`: a
  // hidden item drawn in moreButton's panel, with no tile, no magnifying and no drag (its cell would go as the panel closes for the drag).
  const render = (id: BarItem, free = false) => {
    if (!free && fit.hide.includes(id)) return fit.hide[0] === id ? moreButton() : null;
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
          <StartMark icon={startIcon} size={Math.round(size * 0.72)} />
        </Item>
      );
    if (id === "apps") {
      const apps = shownButtons.map((b, i) => {
        if (b.folder) {
          const { id: fid, apps: inside } = b.folder;
          // A launch from its panel that failed shows here, as "…" shows its apps'.
          const failed = error !== null && inside.some((a) => a.key === error.key);
          return (
            <Item
              key={b.key}
              {...item(b.key, b.name)}
              {...(failed && { label: menu || open ? null : error.text, failed })}
              ref={(el) => {
                if (el) appButtons.current.set(b.key, el);
                else appButtons.current.delete(b.key);
              }}
              tile={tile()}
              // As a pinned app without windows: an icon's width, and while the bar shows titles it only lifts.
              width={appWidth}
              magnify={titled ? undefined : mag}
              describedBy={`decor-${i}`}
              pin={b.key}
              expanded={folderId === fid}
              // Every click opens it, Shift, Ctrl and the middle button too; Enter or Space with the keyboard on its first app.
              onClick={(e) => afterDrag(e) || openFolder(fid, e.detail === 0 ? "first" : undefined)}
              onAuxClick={(e) => {
                if (e.button === 1) openFolder(fid);
              }}
              onPointerDown={(e) => {
                if (e.button === 1) e.preventDefault();
                else dragPin(b.key, e);
              }}
              onContextMenu={(e) => toggle({ kind: "folder", b }, e.currentTarget)}
            >
              <span className="relative flex">
                <FolderIcon icons={inside.map((a) => icons[a.key])} size={appIcon} />
                <span id={`decor-${i}`} className="sr-only">
                  {inside.length === 1 ? t("Ordner, 1 App") : t("Ordner, {n} Apps", { n: inside.length })}
                </span>
              </span>
            </Item>
          );
        }
        const entry = launchId(b);
        const d = buttonDecor(b.windows, decor, active);
        const overlay = d.overlay && decorPics[d.overlay.img];
        const said = [stateText(b, active), d.overlay?.tip, d.progress && progressText(d.progress)].filter(Boolean).join(", ");
        // An open app of a folder is not at its place among the pinned apps: it does not drag.
        const drags = b.pin !== null && !b.inFolder;
        return (
          <Item
            key={b.key}
            {...item(b.key, windowCount && windowBadge(b.windows.length) ? t("{name}, {n} Fenster", { name: b.title ?? b.name, n: b.windows.length }) : (b.title ?? b.name))}
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
            width={titled && b.title !== undefined ? fit.label : appWidth}
            // A wide button growing as a dock's icon would cover its neighbours; Windows' titled buttons do not grow.
            magnify={titled ? undefined : mag}
            labelled={titled && b.title !== undefined}
            mark={indicator(b, active, flashing)}
            progress={d.progress}
            // By index: group keys hold characters an id list cannot.
            describedBy={said ? `decor-${i}` : undefined}
            pin={drags ? b.pin!.id : undefined}
            {...dragRest(b)}
            // Only a pinned app's press can have dragged; another app's click never follows one.
            onClick={(e) => (drags && afterDrag(e)) || click(b, e.currentTarget, false, { shift: e.shiftKey, ctrl: e.ctrlKey })}
            onAuxClick={(e) => {
              if (e.button === 1) click(b, e.currentTarget, false, { middle: true });
            }}
            // The middle button would start WebView2's autoscroll circle; the left one drags a pinned app.
            onPointerDown={(e) => {
              if (e.button === 1) e.preventDefault();
              else if (drags) dragPin(b.pin!.id, e);
            }}
            onContextMenu={(e) => toggle({ kind: menuKind(b, e.shiftKey), b }, e.currentTarget)}
          >
            <span className="relative flex">
              <AppIcon src={entry === null ? ownIcons[appKey(b)] : icons[entry]} size={appIcon} />
              {/* The app's badge, two thirds of the icon at its bottom end corner, as Windows draws it. */}
              {overlay && <img alt="" src={overlay} className="absolute -end-0.5 -bottom-0.5" style={{ width: trayIcon(appIcon), height: trayIcon(appIcon) }} />}
              {said && (
                <span id={`decor-${i}`} className="sr-only">
                  {said}
                </span>
              )}
            </span>
            {windowCount && <Badge text={windowBadge(b.windows.length)} />}
            {titled && b.title !== undefined && (
              <span dir="auto" className="ms-2 min-w-0 truncate text-footnote">
                {b.title}
              </span>
            )}
          </Item>
        );
      });
      if (fit.mode !== "overflow") return apps;
      const n = hiddenButtons.length;
      // A launch from the panel that failed shows here, as its app has no button of its own on the bar.
      const failed = error !== null && hiddenButtons.some((b) => b.key === error.key || b.folder?.apps.some((a) => a.key === error.key));
      return [
        ...apps,
        <Item
          key="apps-more"
          {...item("apps-more", t(n === 1 ? "{n} weitere App" : "{n} weitere Apps", { n }))}
          ref={appsMore}
          {...(failed && { label: menu || open ? null : error.text, failed })}
          tile={tile()}
          width={appWidth}
          magnify={mag}
          // Open or asking for attention, as one app with every hidden app's windows.
          mark={indicator({ key: "", name: "", pin: null, pins: [], windows: hiddenButtons.flatMap((b) => b.windows) }, active, flashing)}
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
      // The clock alone may show on the other bars; it draws from the local time, not from the notch's feed.
      if (!primary && !(id === "clock" && s.taskbar.clockAll)) return null;
      // The clock's Time and weather and the date's week, whose weather opens Weather on the main bar (clickWidget).
      const tool = widgetTool(id), own = widgetPanel(id, primary), split = primary && weatherWanted([id], s.taskbar.variants);
      return (
        <WidgetItem
          id={id}
          // A widget that opens a panel in the bar says whether it shows, so a press on it is left to its click and the panel moves in
          // place; one whose tool opens in the notch, or that opens nothing, says nothing.
          item={{
            ...item(id, t(partInfo[id].label)),
            kind: id,
            tile: free ? undefined : tile(),
            expanded: own
              ? open?.content.kind === own || (split && open?.content.kind === "tool" && open.content.tool === "weather")
              : tool === null || !opensInBar({ kind: "tool", tool })
                ? undefined
                : open?.content.kind === "tool" && open.content.tool === tool,
          }}
          paused={paused}
          onClick={(e, key, slot) => (!free && afterDrag(e)) || clickWidget(id, e.currentTarget, key, slot)}
          onPointerDown={free ? undefined : dragFrom(id)}
          // A widget with rows of its own opens its menu over it; the others the Crest menu over the pointer, as beside the buttons.
          onContextMenu={(e) => (hasWidgetMenu(id) || split ? toggle({ kind: "widget", id }, e.currentTarget) : setMenu({ kind: "crest", anchor: null, x: e.clientX, w: 0 }))}
        />
      );
    }
    if (isTool(id)) {
      // As a widget: on the primary bar only.
      if (!primary) return null;
      const tool = toolOf(id);
      return (
        <Item
          {...item(id, t(toolInfo[tool].label))}
          kind={id}
          tile={free ? undefined : tile()}
          // A tray icon's slot, as the tray draws it.
          width={tiles ? undefined : trayIcon(size) + 16}
          // Only a tool the panel shows says whether it is open; one the notch opens leaves the bar's panel closed.
          expanded={opensInBar({ kind: "tool", tool }) ? open?.content.kind === "tool" && open.content.tool === tool : undefined}
          onClick={(e) => {
            if (!free && afterDrag(e)) return;
            setError(null);
            setMenu(null);
            openTool(tool, e.currentTarget);
          }}
          onPointerDown={free ? undefined : dragFrom(id)}
          // No menu of its own, as a widget: the Crest menu over the pointer.
          onContextMenu={(e) => setMenu({ kind: "crest", anchor: null, x: e.clientX, w: 0 })}
        >
          <ToolGlyph tool={tool} size={trayIcon(size)} plus={look.look === "plus"} />
        </Item>
      );
    }
    if (isSys(id)) {
      // Windows widgets on the primary bar only, as Windows has it.
      if (!primary && sysPrimaryOnly(id)) return null;
      const sys = sysOf(id);
      return (
        <SysButton
          id={sys}
          item={{
            ...item(id, t(SYS_INFO[sys].label)),
            kind: id,
            tile: free ? undefined : tile(),
            magnify: free ? undefined : mag,
            expanded: sys === "searchbox" ? open?.content.kind === "search" : undefined,
            onPointerDown: free ? undefined : dragFrom(id),
            // No menu of its own, as a widget: the Crest menu over the pointer; the Recycle Bin has Open and Empty.
            onContextMenu: (e) => (sys === "recycle" ? toggle({ kind: "recycle" }, e.currentTarget) : setMenu({ kind: "crest", anchor: null, x: e.clientX, w: 0 })),
          }}
          dragged={free ? () => false : afterDrag}
          onOpen={sys === "recent" ? (anchor) => toggle({ kind: "recent" }, anchor) : sys === "searchbox" ? openSearch : undefined}
        />
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
        <Item
          {...item("crest", t("Crest-Menü"))}
          kind="crest"
          tile={tile()}
          magnify={mag}
          onClick={(e) => afterDrag(e) || openCrestMenu(e)}
          onPointerDown={dragFrom(id)}
          onContextMenu={openCrestMenu}
        >
          <CrestMark size={size} />
        </Item>
      );
    return id satisfies never;
  };

  /** Files from File Explorer on the apps: the line shows where they go, and Rust pins those that are apps (ownpins.rs `dropped`). Which ones are is Rust's call: during a drag the page cannot tell an exe from its name. */
  const fileDrop = {
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "link";
      fileDrag.set({ x: e.clientX, y: e.clientY });
    },
    onDragLeave: () => fileDrag.set(null),
    onDrop: (e: DragEvent) => {
      fileDrag.set(null);
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      dropBefore.current = placeAt(bar.current, { id: null, x: e.clientX, y: e.clientY }, between)?.before ?? null;
      postFiles("taskbar-drop", [...e.dataTransfer.files]);
    },
  };

  /** Each item in a box-less span the drop measures it by (ItemDrop); the draggable ones keep touch for the drag, the dragged one dims. */
  const place = (id: BarItem) => (
    <span key={id} data-item={id} className={`contents ${trashable(id) || id === "apps" ? "*:touch-none" : ""} ${dragged === id ? "*:opacity-40" : ""}`} {...(id === "apps" ? fileDrop : {})}>
      {render(id)}
    </span>
  );

  /** A cell in the panel: an app's icon and mark, a folder's first four apps. */
  const cellOf = (b: BarButton) => {
    const entry = launchId(b);
    return { b, icon: entry === null ? ownIcons[appKey(b)] : icons[entry], mark: indicator(b, active, flashing), ...(b.folder && { minis: b.folder.apps.map((a) => icons[a.key]) }) };
  };
  // In the middle of the 8 px under the cell's icon, as markAt is under the bar's.
  const cellMark = Math.round((8 - markThick(marks)) / 2);

  const drop = <TrayDrop bar={bar} more={trayMore} size={trayIcon(size)} gap={between} />;
  return (
    <BarEdgeContext value={edge}>
    <div
      // Clipped, so the bar slid off the screen leaves #root nothing to scroll to when one of its buttons takes the focus.
      className={`flex h-full flex-col ${edge === "top" ? "justify-start" : "justify-end"} overflow-clip`}
      style={{ ["--accent" as string]: accent }}
      // A right click during a drag opens nothing, on any button or beside them.
      onContextMenuCapture={(e) => {
        if (!itemDrag.get() && !pinDrag.get()) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      // A right click beside the buttons, on the bar or in the gap under it: the Crest menu, over the pointer. Not in the panel.
      onContextMenu={(e) => {
        if ((e.target as Element).closest("button, [role=menu], [role=dialog]")) return;
        setMenu({ kind: "crest", anchor: null, x: e.clientX, w: 0 });
      }}
      // A double click there, as Windows' taskbar takes one: Show desktop or Task Manager when the setting says so. Not in the panel.
      onDoubleClick={(e) => {
        const act = s.taskbar.emptyDouble;
        if (act === "none" || (e.target as Element).closest("button, [role=menu], [role=dialog], [data-tray-panel]")) return;
        holdBriefly();
        void taskbar.shell(act).catch(() => {});
      }}
    >
      {/* On the closed notch's black, and always under Liquid Glass +, the bar and its menus keep the closed notch's ink whatever the theme (useBarSurface), and its zones keep their sides in any language. */}
      <div data-theme-ink dir="ltr" className="contents" style={look.ink}>
        {look.glass && <BarGlass {...look.glass} />}
        {/* The shape's place stays still, so its box is the band at rest while the shape slides out of it (useHitZone measures this box). */}
        <div
          ref={bar}
          // The site's demo lets the pointer through its layer except here (src/dev/demoBar.tsx), as Rust does around the bar.
          data-bar
          role="toolbar"
          aria-label={t("Crest-Taskleiste")}
          onPointerDownCapture={() => {
            keyNav.current = false;
            setFocusIn(false);
          }}
          onFocus={() => keyNav.current && setFocusIn(true)}
          onBlur={(e) => setFocusIn(keyNav.current && e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))}
          // Arrows, Home and End go from button to button in the zones' order (laid out left to right in every language); Esc gives the
          // keyboard back to the app in front. Tab, Enter, Space and the menu key work as on any button.
          onKeyDown={(e) => {
            const el = e.target;
            if (!(el instanceof HTMLButtonElement) || !bar.current || e.altKey || e.ctrlKey || e.metaKey) return;
            keyNav.current = true;
            if (e.key === "Escape") {
              el.blur();
              return void taskbar.release();
            }
            const all = [...bar.current.querySelectorAll("button")];
            const to = barArrow(e.key, all.indexOf(el), all.length);
            if (to === undefined) return;
            e.preventDefault();
            all[to].focus({ preventScroll: true });
          }}
          className={shape === "capsule" ? "self-center" : undefined}
          style={{ margin: barMargin(edge, gap, shape === "capsule") }}
          // The bar only, never a menu or the panel above it.
          // Not while dragging: no icon grows under the ghost.
          // Nor while a preview card is open: the icons hold still round its button.
          onPointerMove={(e) => {
            lastX.current = e.clientX;
            if (!itemDrag.get() && !pinDrag.get() && !card.current) pointer.set(e.clientX);
          }}
          onPointerLeave={() => {
            lastX.current = Infinity;
            if (!card.current) pointer.set(Infinity);
          }}
          onWheel={onWheel}
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
        {/* In the bar's ink, so the ghost has the bar's colours, and so has the trash, over the bare desktop like the menus. */}
        <ItemDrop bar={bar} size={trayIcon(size)} gap={between} off={gap + height + MENU_GAP} />
        <PinDrop bar={bar} size={appIcon} gap={between} icons={icons} />
        <AnimatePresence>
          {/* Gone in the very commit the panel opens in, so its zone is cleared before the panel's box goes in, never after. */}
          {menu && !open && (
            <BarMenu
              key={`${menu.kind}@${menu.x}`}
              title={
                menu.kind === "crest"
                  ? t("Crest-Menü")
                  : menu.kind === "recycle"
                    ? t("Papierkorb")
                    : menu.kind === "recent"
                      ? t("Zuletzt geöffnet")
                      : menu.kind === "widget"
                        ? t(partInfo[menu.id].label)
                        : menu.kind === "move"
                          ? t("In Ordner verschieben …")
                          : menu.b.name
              }
              x={menu.x}
              w={menu.w}
              off={gap + height + MENU_GAP}
              anchor={menu.anchor}
              onClose={closeMenu}
              onPlace={placeMenuZone}
            >
              {menu.kind === "crest" ? (
                <CrestMenu close={closeMenu} />
              ) : menu.kind === "recycle" ? (
                <RecycleMenu close={closeMenu} />
              ) : menu.kind === "recent" ? (
                <RecentMenu close={closeMenu} />
              ) : menu.kind === "widget" ? (
                <WidgetMenu
                  id={menu.id}
                  close={closeMenu}
                  // Over the span the menu opened over: a widget in the hidden items' panel is gone once the menu closed that panel.
                  openTool={(tool) => togglePanel({ kind: "tool", tool }, { x: menu.x, w: menu.w })}
                />
              ) : menu.kind === "window" ? (
                <WindowMenu win={menu.b.windows[0]} close={closeMenu} />
              ) : menu.kind === "group" ? (
                <GroupMenu b={menu.b} close={closeMenu} />
              ) : menu.kind === "app" ? (
                <AppMenu b={menu.b} act={(c) => run(menu.b, c)} close={closeMenu} fail={(text) => setError({ key: menu.b.key, text })} move={() => setMenu({ ...menu, kind: "move" })} />
              ) : menu.kind === "move" ? (
                <MoveMenu b={menu.b} folders={folders} close={closeMenu} created={(id) => void (fresh.current = id)} />
              ) : menu.kind === "folder" ? (
                <FolderMenu id={menu.b.folder!.id} close={closeMenu} rename={() => openFolder(menu.b.folder!.id, "name")} />
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
              off={gap + height + MENU_GAP}
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
        widgets={{
          widths: hidden.map((id) => fit.hideW[fit.hide.indexOf(id)]),
          // Left to right as the bar's zones, as tall as the bar; a click does what it does on the bar, and a panel it opens takes this one's place.
          rows: (
            <div dir="ltr" className="flex h-full flex-wrap content-start overflow-y-auto p-3" style={{ gap: between }}>
              {hidden.map((id) => (
                <span key={id} className="flex" style={{ height }}>
                  {render(id, true)}
                </span>
              ))}
            </div>
          ),
        }}
        apps={{
          count: hiddenButtons.length,
          grid: (
            <AppsPanel
              apps={hiddenButtons.map(cellOf)}
              size={size}
              markAt={cellMark}
              // A click does what the bar's does, over the cell: a window list or an app menu takes the panel's place, and a folder this
              // one's, the panel changing shape in place.
              onClick={(b, cell, mods, keyboard) => {
                if (b.folder) return openFolder(b.folder.id, keyboard ? "first" : undefined);
                closePanel();
                click(b, cell, true, mods);
              }}
              onMenu={(b, cell, shift) => toggle({ kind: menuKind(b, shift), b }, cell)}
            />
          ),
        }}
        folder={
          openedFolder?.folder
            ? {
                name: openedFolder.name,
                count: openedFolder.folder.apps.length,
                body: (
                  <FolderPanel id={openedFolder.folder.id} name={openedFolder.name} focus={folderFocus}>
                    <AppsPanel
                      apps={openedFolder.folder.apps.map(cellOf)}
                      size={size}
                      markAt={cellMark}
                      cols={folderCols(openedFolder.folder.apps.length)}
                      // As in "…": the app starts or comes forward and the panel closes, a window list or the app's menu over the cell.
                      onClick={(b, cell, mods) => {
                        closePanel();
                        click(b, cell, true, mods);
                      }}
                      onMenu={(b, cell, shift) => toggle({ kind: menuKind(b, shift), b }, cell)}
                      // Not dragPress, which closes the panel: the app goes back into it, or onto the bar (PinDrop).
                      onPress={(b, e) =>
                        startPress(e, {
                          threshold: dragThreshold(e.pointerType),
                          onDrag: (x, y) => pinDrag.set({ id: b.key, x, y, pointerId: e.pointerId, from: "folder" }),
                          onEnd: () => pinDrag.set(null),
                        })
                      }
                    />
                  </FolderPanel>
                ),
              }
            : null
        }
      />
      {/* Under Material in the bar's ink as ItemDrop is, so Liquid Glass +'s dark ink reaches its disc and line; Crest's as before, outside it.
          After the panel, which an icon is dragged out of. */}
      {appDesign === "material" ? (
        <div data-theme-ink dir="ltr" className="contents" style={look.ink}>
          {drop}
        </div>
      ) : (
        drop
      )}
      {/* The launch error for screen readers too: a button's label is not read out. */}
      <span role="status" aria-live="polite" className="sr-only">
        {error?.text}
      </span>
    </div>
    </BarEdgeContext>
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
 * the strip at the screen's edge too, alone while the bar is down. The bar counts only once it has a size: the first report says it has
 * drawn, and Windows' taskbar hides then. The boxes are where the shape rests, up or down: `ref` is its still box, the band that
 * decides whether it is down (useAutoHide), and the tiles are taken back by the slide. They go to its glass too. `layout` changes when
 * the tiles may have moved inside a bar that kept its size.
 */
function useHitZone(
  ref: RefObject<HTMLDivElement | null>,
  shape: BarShape,
  edge: BarEdge,
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
    const box = toEdge(edge, rest, window.innerHeight);
    setBand((b) => (b?.x === box.x && b.y === box.y && b.w === box.w && b.h === box.h ? b : box));
    // The sliding layer inside the still box: how far down it is now, which the tiles' boxes give back.
    const layer = el.firstElementChild;
    const dy = layer ? layer.getBoundingClientRect().y - rest.y : 0;
    const tile = (t: Element) => {
      const b = boxOf(t);
      return { ...b, y: b.y - dy };
    };
    const groups = shape === "tiles" && layer ? [...layer.children].map((zone) => [...zone.querySelectorAll("[data-tile]")].map(tile)) : [[rest]];
    const bands = hitBoxes(groupBoxes(groups), window.innerHeight, edge);
    const open = [...(menu.current ? [menu.current] : []), ...(preview.current ? [preview.current] : []), ...(drag.current ? [{ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }] : [])];
    void taskbar.hitRects(hitZones({ bands, open, ...now.current, edge, width: window.innerWidth, height: window.innerHeight }));
    const next = groups.flat();
    setBoxes((b) => (JSON.stringify(b) === JSON.stringify(next) ? b : next));
  }, [ref, shape, edge, setBoxes]);
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

/** What a screen reader hears after an app's name (N1): pinned, its open windows, in front, asking for attention. */
function stateText(b: BarButton, active: number | null): string {
  const n = b.windows.length;
  const word = { pinned: () => t("Angeheftet"), one: () => t("1 Fenster geöffnet"), many: () => t("{n} Fenster geöffnet", { n }), front: () => t("Im Vordergrund"), attention: () => t("Möchte deine Aufmerksamkeit") };
  return appState(b, active).map((s) => word[s]()).join(", ");
}

/** What a screen reader says for an app's progress line. */
function progressText(p: Progress): string {
  if (p.state === "paused") return t("Fortschritt angehalten");
  if (p.state === "error") return t("Fortschritt mit Fehler");
  if (p.state === "indeterminate") return t("Fortschritt läuft");
  return t("Fortschritt {n} %", { n: Math.round(p.value * 100) });
}

/** The window count at the icon's top end corner, growing with it; read in the button's name, so hidden from screen readers. */
function Badge({ text }: { text: string | null }) {
  if (text === null) return null;
  return (
    <span aria-hidden className="absolute -end-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-label px-1 text-[10px] font-semibold leading-none text-notch">
      {text}
    </span>
  );
}
