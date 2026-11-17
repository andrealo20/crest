import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion, useIsPresent } from "motion/react";
import { Check } from "@phosphor-icons/react";
import { popover } from "../../../design/motion";
import { t } from "../../../i18n";
import { onNativeBlur, settingsWindow } from "../../../platform/native";
import { autostart, taskbar } from "../../../platform/services";
import { updateSettings } from "../../../settings/store";
import { MENU_PANEL_CLASS, MENU_ROW_CLASS } from "../../../ui/menu";
import { toggleFavorite, type Favorite } from "../../launcher/apps";
import { launchId, menuFor, menuKey, placeMenu, type BarButton } from "../model";

/** Room a menu keeps from the window's top edge, CSS px, as placeMenu keeps from its sides. */
const EDGE = 8;
/** A menu's rows: its commands and its settings. */
const ROWS = "[role^=menuitem]";

/** A zone of the page that takes the pointer, CSS px. */
export interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A menu over the bar in the Select menu's look: it opens upward, centred over what opened it and kept inside the window. The
 * keyboard moves into it (Up and Down, Home and End; Enter and Space are the rows' own clicks). It closes on Esc (the keyboard then
 * goes back to the app in front), on a pointerdown anywhere else in the bar and when the window loses the focus; a pointerdown on
 * the button it opened from is left to that button's click, which closes it or opens another.
 */
export function BarMenu(props: {
  /** Its name for screen readers. */
  title: string;
  /** What it opens over, CSS px from the window's left edge: its button, or the pointer (w 0). */
  x: number;
  w: number;
  /** Its bottom edge, CSS px above the window's bottom edge. */
  bottom: number;
  anchor: Element | null;
  onClose: () => void;
  /** Its box each time it places itself, null once it closes: the bar's hit zone takes it in. */
  onPlace: (box: HitRect | null) => void;
  children: ReactNode;
}) {
  const { x, w, bottom, anchor, onClose, onPlace } = props;
  // Fading out after it closed, it takes no key, no click and no place in the hit zone.
  const present = useIsPresent();
  const ref = useRef<HTMLDivElement>(null);

  // Placed from its own size, before it first shows and whenever that size changes (a font that arrives late), and the hit zone
  // gets the same box in the same step. `left` is set here rather than rendered: the observer runs before the paint, where a state
  // update would draw the menu a frame after its zone moved.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!present || !el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { inlineSize: width, blockSize: height } = entry.borderBoxSize[0];
      const left = placeMenu(x, w, width, window.innerWidth);
      el.style.left = `${left}px`;
      onPlace({ x: left, y: window.innerHeight - bottom - height, w: width, h: height });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      onPlace(null);
    };
  }, [present, x, w, bottom, onPlace]);
  useEffect(() => {
    if (!present) return;
    ref.current?.querySelector<HTMLElement>(ROWS)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        void taskbar.release();
        return;
      }
      const rows = [...(ref.current?.querySelectorAll<HTMLElement>(ROWS) ?? [])];
      const to = menuKey(e.key, rows.indexOf(document.activeElement as HTMLElement), rows.length);
      if (to === undefined) return;
      e.preventDefault();
      rows[to].focus({ preventScroll: true });
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
  }, [present, anchor, onClose]);

  return (
    <motion.div
      ref={ref}
      role="menu"
      aria-label={props.title}
      // The page's direction: the zones around it are physical (dir="ltr"), the menu reads as the rest of Crest.
      dir={document.documentElement.dir}
      className={`${MENU_PANEL_CLASS} w-max max-w-80 min-w-40`}
      // The focus leaves its rows, so a second Enter while it fades does not run one again.
      inert={!present}
      style={{ bottom, maxHeight: window.innerHeight - bottom - EDGE, transformOrigin: "50% 100%", pointerEvents: present ? undefined : "none" }}
      initial={{ opacity: 0, transform: "scale(0.96) translateY(2px)" }}
      animate={{ opacity: 1, transform: "scale(1) translateY(0px)", transition: popover.enter }}
      exit={{ opacity: 0, transform: "scale(0.98)", transition: popover.exit }}
    >
      {props.children}
    </motion.div>
  );
}

/** A command, or a setting with its check (`checked`), whose place is kept while it is off so the menu never changes width. */
function Row(props: { label: string; onClick: () => void; checked?: boolean }) {
  return (
    <button
      role={props.checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={props.checked}
      onClick={props.onClick}
      className={`${MENU_ROW_CLASS} gap-2 text-label outline-none focus-visible:bg-fill-2`}
    >
      <span dir="auto" className="truncate">
        {props.label}
      </span>
      {props.checked !== undefined && <Check size={13} weight="bold" className={`ms-auto shrink-0 ${props.checked ? "" : "invisible"}`} />}
    </button>
  );
}

/** Pins or unpins an app; the other windows follow the saved settings. */
const togglePin = (app: Favorite) => updateSettings((s) => ({ taskbar: { ...s.taskbar, pinned: toggleFavorite(s.taskbar.pinned ?? [], app) } }));

/** An app's right-click menu, as menuFor allows it. `launch` starts the app as a click on its button does, errors included. */
export function AppMenu({ b, launch, close }: { b: BarButton; launch: (id: string) => void; close: () => void }) {
  // A window of an app run as administrator may refuse to close; nothing changes then.
  const closeWindows = () => b.windows.forEach((win) => void taskbar.window(win.id, "close").catch(() => {}));
  const entries = {
    newWindow: [t("Neues Fenster"), () => launch(launchId(b)!)],
    pin: [t("Anheften"), () => togglePin(b.pins[0])],
    unpin: [t("Lösen"), () => togglePin(b.pin!)],
    close: [t("Fenster schließen"), closeWindows],
    closeAll: [t("Alle Fenster schließen"), closeWindows],
  } as const;
  return (
    <>
      {menuFor(b).map((e) => {
        const [label, run] = entries[e];
        return (
          <Row
            key={e}
            label={label}
            onClick={() => {
              close();
              run();
            }}
          />
        );
      })}
    </>
  );
}

/** The windows of an app with several, by title; a click brings that one forward. */
export function WindowList({ b, close }: { b: BarButton; close: () => void }) {
  return (
    <>
      {b.windows.map((win) => (
        <Row
          key={win.id}
          label={win.title || b.name}
          onClick={() => {
            close();
            taskbar.window(win.id, "activate").catch(() => {});
          }}
        />
      ))}
    </>
  );
}

/** The tray menu's entries: the notch, the Taskbar settings, Start with Windows (read each time the menu opens), Quit. */
export function CrestMenu({ close }: { close: () => void }) {
  const [auto, setAuto] = useState<boolean | null>(null);
  useEffect(() => {
    autostart.get().then(setAuto, () => {});
  }, []);
  const run = (action: () => Promise<void>) => () => {
    close();
    void action();
  };
  return (
    <>
      <Row label={t("Crest öffnen")} onClick={run(() => settingsWindow.notchOpen(null))} />
      <Row label={t("Einstellungen …")} onClick={run(() => settingsWindow.open("taskbar"))} />
      <Row
        label={t("Mit Windows starten")}
        checked={auto === true}
        onClick={() => {
          if (auto === null) return;
          setAuto(!auto);
          // Windows can refuse (the Store build's startup task switched off in Task Manager): the check shows the real state then.
          autostart.set(!auto).catch(() => autostart.get().then(setAuto, () => {}));
        }}
      />
      <Row label={t("Crest beenden")} onClick={run(taskbar.quit)} />
    </>
  );
}
