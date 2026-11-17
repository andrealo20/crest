import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEventHandler, type ReactNode, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import { fade, popover, pulse, springs } from "../../../design/motion";
import { t } from "../../../i18n";
import { launcher, taskbar } from "../../../platform/services";
import { settings } from "../../../settings/store";
import { CrestMark } from "../../../ui/CrestMark";
import { AppIcon } from "../../launcher/AppIcon";
import { useIcons } from "../../launcher/store";
import { useClosedInk, useThemedAccent } from "../../themes/store";
import { barButtons, clickAction, fitIcon, indicator, launchId, placeMenu, type BarButton, type BarItem, type Indicator, type Zone } from "../model";
import { barWindows, groupIcons } from "../store";
import { AppMenu, BarMenu, CrestMenu, WindowList } from "./BarMenu";

/** Room between the bar and the screen's sides and bottom, CSS px (src-tauri/src/taskbar/bar.rs GAP). */
const GAP = 4;
/** Room between the bar and a menu above it, CSS px, as between a button and its name. */
const MENU_GAP = 8;
/** Thickness of the mark under an app, CSS px. */
const MARK = 3;
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
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useHitZone(bar, panel);
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
    ) : (
      <Item {...item("crest", t("Crest-Menü"))} onClick={openCrestMenu} onContextMenu={openCrestMenu}>
        <CrestMark size={size} />
      </Item>
    );

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
              onPanel={setPanel}
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
 * and the open menu. Only once the bar has a size: the first report says it has drawn, and Windows' taskbar hides then.
 */
function useHitZone(ref: RefObject<HTMLDivElement | null>, menu: HTMLElement | null) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return;
      const rects = [{ x: r.x, y: r.y, w: r.width, h: window.innerHeight - r.y }];
      // The menu's layout box: the scale it opens with would shrink a measured one.
      if (menu) rects.push({ x: menu.offsetLeft, y: menu.offsetTop, w: menu.offsetWidth, h: menu.offsetHeight });
      void taskbar.hitRects(rects);
    };
    const observer = new ResizeObserver(report);
    observer.observe(el);
    if (menu) observer.observe(menu);
    // Another monitor or scale can move the bar without resizing it.
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [ref, menu]);
}

/** A button on the bar: its icon lifts under the pointer, with its name (or what went wrong) in a label above. */
function Item(props: {
  name: string;
  label: string | null;
  failed: boolean;
  lifted: boolean;
  size: number;
  markAt: number;
  mark?: Indicator;
  onEnter: () => void;
  onLeave: () => void;
  onClick: MouseEventHandler<HTMLButtonElement>;
  onContextMenu: MouseEventHandler<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    // The gap under the bar (GAP, h-1) belongs to the button above it, so a click with the pointer pushed against the screen's
    // edge, left or right, lands on the button; the gap itself stays empty.
    <button
      aria-label={props.name}
      onPointerEnter={props.onEnter}
      onPointerLeave={props.onLeave}
      onClick={props.onClick}
      onContextMenu={props.onContextMenu}
      className="pressable relative flex shrink-0 items-center justify-center after:absolute after:inset-x-0 after:top-full after:h-1"
      style={{ width: props.size + 16 }}
    >
      <motion.span className="flex" initial={false} animate={{ transform: `translateY(${props.lifted ? -2 : 0}px)` }} transition={springs.peek}>
        {props.children}
      </motion.span>
      {props.mark && <Mark kind={props.mark} bottom={props.markAt} />}
      <Label text={props.label} failed={props.failed} />
    </button>
  );
}

/**
 * Under an app: a dot while it is open, a longer mark while it is in front, the accent pulsing while a window asks for attention.
 * Both shapes are drawn whole and change by opacity and scale only.
 */
function Mark({ kind, bottom }: { kind: Indicator; bottom: number }) {
  const long = kind === "front" || kind === "attention";
  return (
    // No initial={false} here: it would leave a mark that appears asking for attention still, at the pulse's last keyframe.
    <motion.span
      className="absolute inset-x-0 flex justify-center"
      style={{ bottom, height: MARK }}
      animate={{ opacity: kind === "attention" ? [1, 0.35] : 1 }}
      transition={kind === "attention" ? pulse : fade}
    >
      <motion.span
        className="absolute rounded-full bg-label-2"
        style={{ width: MARK, height: MARK }}
        initial={false}
        animate={{ opacity: kind === "open" ? 1 : 0, transform: `scale(${kind === "open" ? 1 : 0.5})` }}
        transition={springs.snappy}
      />
      <motion.span
        className={`absolute w-4 rounded-full ${kind === "attention" ? "bg-accent" : "bg-label"}`}
        style={{ height: MARK }}
        initial={false}
        animate={{ opacity: long ? 1 : 0, transform: `scaleX(${long ? 1 : 0.25})` }}
        transition={springs.snappy}
      />
    </motion.span>
  );
}

/** A button's name above it, or what went wrong; never takes the pointer. */
function Label({ text, failed }: { text: string | null; failed: boolean }) {
  return <AnimatePresence>{text !== null && <Bubble key={text} text={text} failed={failed} />}</AnimatePresence>;
}

function Bubble({ text, failed }: { text: string; failed: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  // Centred over its button, and moved only as far as it must to stay inside the window, as the menus do.
  useLayoutEffect(() => {
    const el = ref.current;
    const button = el?.parentElement?.getBoundingClientRect();
    if (!el || !button) return;
    const w = el.offsetWidth;
    setShift(placeMenu(button.x, button.width, w, window.innerWidth) - (button.x + button.width / 2 - w / 2));
  }, []);
  return (
    <motion.span
      ref={ref}
      dir="auto"
      className={`pointer-events-none absolute bottom-full left-1/2 mb-2 max-w-80 -translate-x-1/2 truncate rounded-[8px] bg-elevated px-2 py-1 text-footnote font-medium shadow-[0_4px_14px_rgb(0_0_0/0.4)] ring-1 ring-separator ${failed ? "text-red" : "text-label"}`}
      style={{ marginLeft: shift }}
      initial={{ opacity: 0, transform: "translateY(2px) scale(0.96)" }}
      animate={{ opacity: 1, transform: "translateY(0px) scale(1)", transition: popover.enter }}
      exit={{ opacity: 0, transform: "scale(0.98)", transition: popover.exit }}
    >
      {text}
    </motion.span>
  );
}
