import { Fragment, useCallback, useEffect, useRef, useState, type MouseEventHandler, type RefObject } from "react";
import { AnimatePresence } from "motion/react";
import { t } from "../../../i18n";
import { launcher, taskbar } from "../../../platform/services";
import { settings } from "../../../settings/store";
import { CrestMark } from "../../../ui/CrestMark";
import { AppIcon } from "../../launcher/AppIcon";
import { useIcons } from "../../launcher/store";
import { useClosedInk, useThemedAccent } from "../../themes/store";
import { barButtons, clickAction, fitIcon, indicator, launchId, type BarButton, type BarItem, type Zone } from "../model";
import { barWindows, groupIcons } from "../store";
import { AppMenu, BarMenu, CrestMenu, WindowList, type HitRect } from "./BarMenu";
import { Item, MARK } from "./Item";

/** Room between the bar and the screen's sides and bottom, CSS px (src-tauri/src/taskbar/bar.rs GAP). */
const GAP = 4;
/** Room between the bar and a menu above it, CSS px, as between a button and its name. */
const MENU_GAP = 8;
const ZONES: [Zone, string][] = [
  ["left", "justify-start"],
  ["center", "justify-center"],
  ["right", "justify-end"],
];

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
  const { zones, height, iconSize, surface, pinned } = settings.use().taskbar;
  const { groups, active } = barWindows.use();
  const ink = useClosedInk(undefined);
  const accent = useThemedAccent(undefined);
  const bar = useRef<HTMLDivElement>(null);
  // The button under the pointer, and a launch that failed (in its button's label for a while).
  const [hovered, setHovered] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const placeMenuZone = useHitZone(bar);
  // Once the window lets the pointer through, the page sees no pointerleave: Rust says when the pointer left the bar.
  useEffect(
    () =>
      taskbar.onHover((inside) => {
        if (!inside) setHovered(null);
      }),
    [],
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

  /** Opens a menu over its button, or closes it on a second click there; another button's menu takes the place of an open one. */
  const toggle = (next: Menu, anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect();
    setMenu((m) => (m?.kind === next.kind && m.anchor === anchor ? null : { ...next, anchor, x: r.x, w: r.width }));
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

  const item = (key: string, name: string) => ({
    name,
    // An open menu hides the names, which would show around it.
    label: menu ? null : error?.key === key ? error.text : hovered === key ? name : null,
    failed: error?.key === key,
    lifted: hovered === key,
    size,
    markAt,
    onEnter: () => setHovered(key),
    onLeave: () => setHovered((h) => (h === key ? null : h)),
  });

  const render = (id: BarItem) =>
    id === "apps" ? (
      buttons.map((b) => {
        const entry = launchId(b);
        return (
          <Item
            key={b.key}
            {...item(b.key, b.name)}
            mark={indicator(b, active)}
            onClick={(e) => click(b, e.currentTarget)}
            onContextMenu={(e) => toggle({ kind: "app", b }, e.currentTarget)}
          >
            <AppIcon src={entry === null ? ownIcons[b.key] : icons[entry]} size={size} />
          </Item>
        );
      })
    ) : id === "crest" ? (
      <Item {...item("crest", t("Crest-Menü"))} onClick={openCrestMenu} onContextMenu={openCrestMenu}>
        <CrestMark size={size} />
      </Item>
    ) : null;

  return (
    <div
      className="flex h-full flex-col justify-end"
      style={{ ["--accent" as string]: accent }}
      // A right click beside the buttons, on the bar or in the gap under it: the Crest menu, over the pointer.
      onContextMenu={(e) => {
        if (!(e.target as Element).closest("button, [role=menu]")) setMenu({ kind: "crest", anchor: null, x: e.clientX, w: 0 });
      }}
    >
      {/* On the closed notch's black the bar and its menus keep their dark tokens whatever the theme (Notch.tsx), and its zones keep their sides in any language. */}
      <div data-theme-ink dir="ltr" className="contents" style={surface === "notch" ? ink : undefined}>
        <div
          ref={bar}
          className="grid grid-cols-[1fr_auto_1fr] rounded-[12px] px-1 text-label"
          style={{ height, margin: `0 ${GAP}px ${GAP}px`, background: surface === "notch" ? "var(--notch-closed)" : "var(--color-notch)" }}
        >
          {ZONES.map(([zone, justify]) => (
            <div key={zone} className={`flex min-w-0 gap-0.5 ${justify}`}>
              {zones[zone].map((id) => (
                <Fragment key={id}>{render(id)}</Fragment>
              ))}
            </div>
          ))}
        </div>
        <AnimatePresence>
          {menu && (
            <BarMenu
              key={`${menu.kind}@${menu.x}`}
              title={menu.kind === "crest" ? t("Crest-Menü") : menu.b.name}
              x={menu.x}
              w={menu.w}
              bottom={GAP + height + MENU_GAP}
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
      {/* The launch error for screen readers too: a button's label is not read out. */}
      <span role="status" aria-live="polite" className="sr-only">
        {error?.text}
      </span>
    </div>
  );
}

/**
 * Tells Rust where the page takes the pointer: the bar and the gap under it, so a click in the gap never reaches the app behind,
 * and the open menu, whose box comes through the returned function each time the menu places itself (null once it closes). The
 * bar counts only once it has a size: the first report says it has drawn, and Windows' taskbar hides then.
 */
function useHitZone(ref: RefObject<HTMLDivElement | null>) {
  const menu = useRef<HitRect | null>(null);
  const report = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) void taskbar.hitRects([{ x: r.x, y: r.y, w: r.width, h: window.innerHeight - r.y }, ...(menu.current ? [menu.current] : [])]);
  }, [ref]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(report);
    observer.observe(el);
    // Another monitor or scale can move the bar without resizing it.
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [ref, report]);
  return useCallback(
    (box: HitRect | null) => {
      menu.current = box;
      report();
    },
    [report],
  );
}
