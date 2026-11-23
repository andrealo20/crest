import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion, useIsPresent, useReducedMotion } from "motion/react";
import { Check } from "../../../ui/iconset";
import { design } from "../../../design/design";
import { popover } from "../../../design/motion";
import { t } from "../../../i18n";
import { onNativeBlur, settingsWindow } from "../../../platform/native";
import { autostart, taskbar } from "../../../platform/services";
import { settings, updateSettings } from "../../../settings/store";
import { MENU_PANEL_CLASS, MENU_ROW_CLASS } from "../../../ui/menu";
import { toggleFavorite, type Favorite } from "../../launcher/apps";
import { folderKey, intoFolder, newFolder, nextName, normalizeFolders, takeOut, ungroup, type Folder, type Pins } from "../folderModel";
import { recycleBin, setTaskbar } from "../store";
import { folderLabel } from "./FolderPanel";
import { holdBriefly } from "./hold";
import { GROUP_MENU, appKey, jumpHeading, menuFor, menuKey, newInstance, placeMenu, windowMenuRows, type BarButton, type Click, type GroupEntry, type JumpList, type Win, type WindowEntry, type WindowState } from "../model";
import { growFrom, nudge, popupAt, popupY } from "../position";
import { useBarEdge } from "./barEdge";

/** Room a menu keeps from the window's top edge, CSS px, as placeMenu keeps from its sides. */
const EDGE = 8;
/** A menu's rows: its commands and its settings. */
export const ROWS = "[role^=menuitem]:not(:disabled)";

/** A zone of the page that takes the pointer, CSS px. */
export interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A menu over the bar in the Select menu's look: it opens away from the bar, centred on what opened it and kept inside the window. The
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
  /** Its edge towards the bar, CSS px from the window's edge on the bar's side (position.ts). */
  off: number;
  anchor: Element | null;
  onClose: () => void;
  /** Its box each time it places itself, null once it closes: the bar's hit zone takes it in. */
  onPlace: (box: HitRect | null) => void;
  children: ReactNode;
}) {
  const { x, w, off, anchor, onClose, onPlace } = props;
  const edge = useBarEdge();
  // Fading out after it closed, it takes no key, no click and no place in the hit zone.
  const present = useIsPresent();
  const appDesign = design.use();
  // MotionConfig's reducedMotion keeps a transform string, so the reduced start is chosen here: Crest's slight one.
  const reduced = useReducedMotion() === true;
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
      onPlace({ x: left, y: popupY(edge, off, height, window.innerHeight), w: width, h: height });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      onPlace(null);
    };
  }, [present, x, w, off, edge, onPlace]);
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
      style={{ ...popupAt(edge, off), maxHeight: window.innerHeight - off - EDGE, transformOrigin: growFrom(edge), pointerEvents: present ? undefined : "none" }}
      initial={{ opacity: 0, transform: `scale(${appDesign === "material" && !reduced ? 0.8 : 0.96}) translateY(${nudge(edge)}px)` }}
      animate={{ opacity: 1, transform: "scale(1) translateY(0px)", transition: popover.enter }}
      exit={{ opacity: 0, transform: "scale(0.98)", transition: popover.exit }}
    >
      {props.children}
    </motion.div>
  );
}

/** A command, or a setting with its check (`checked`), whose place is kept while it is off so the menu never changes width. */
export function Row(props: { label: string; onClick: () => void; checked?: boolean; icon?: string | null; disabled?: boolean }) {
  return (
    <button
      role={props.checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={props.checked}
      disabled={props.disabled}
      aria-disabled={props.disabled}
      onClick={props.onClick}
      className={`${MENU_ROW_CLASS} gap-2 text-label outline-none focus-visible:bg-fill-2 disabled:text-label-3`}
    >
      {props.icon !== undefined &&
        (props.icon ? <img src={props.icon} alt="" draggable={false} className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />)}
      <span dir="auto" className="truncate">
        {props.label}
      </span>
      {props.checked !== undefined && <Check size={13} weight="bold" className={`ms-auto shrink-0 ${props.checked ? "" : "invisible"}`} />}
    </button>
  );
}

/** Pins or unpins an app; the other windows follow the saved settings. */
export const togglePin = (app: Favorite) => updateSettings((s) => ({ taskbar: { ...s.taskbar, pinned: toggleFavorite(s.taskbar.pinned ?? [], app) } }));

/** A write to the pinned apps and their folders (folderModel.ts), on the settings as they are now with the folders repaired; written only when it changes something. */
export function editPins(edit: (p: Pins) => Pins): void {
  const { pinned, folders } = settings.get().taskbar;
  if (!pinned) return;
  const p = { pinned, folders: normalizeFolders(folders, pinned) };
  const next = edit(p);
  if (next !== p) setTaskbar(next);
}

/** Closes all of an app's windows; a window of an app run as administrator may refuse, and nothing changes then. */
export const closeWindows = (b: BarButton) => b.windows.forEach((win) => void taskbar.window(win.id, "close").catch(() => {}));

/**
 * The app's jump list over its entries, as Windows 11 puts it: nothing until Rust answers, then each group under its heading and
 * a line before the entries. A row opens with the app; when it cannot, `fail` says so in the button's label.
 */
function JumpRows({ b, close, fail }: { b: BarButton; close: () => void; fail: (text: string) => void }) {
  const [list, setList] = useState<JumpList | null>(null);
  const key = appKey(b);
  useEffect(() => {
    let live = true;
    taskbar.jumpList(key).then(
      (l) => live && setList(l),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [key]);
  if (!list?.groups.length) return null;
  return (
    <>
      {list.groups.map((g) => {
        const h = jumpHeading(g);
        const heading = "key" in h ? t(h.key) : h.text;
        return (
          <div key={`${g.kind}:${g.title}`} role="group" aria-label={heading}>
            <div dir="auto" aria-hidden className="text-caption text-label-3 px-2 pt-1.5 pb-0.5 truncate">
              {heading}
            </div>
            {g.items.map((item) =>
              item.separator ? (
                <div key={item.id} className="h-px bg-separator my-1" />
              ) : (
                <Row
                  key={item.id}
                  label={item.title}
                  icon={item.icon}
                  onClick={() => {
                    close();
                    taskbar.jumpOpen(list.token, item.id).catch(() => fail(t("{name} kann das nicht öffnen", { name: b.name })));
                  }}
                />
              ),
            )}
          </div>
        );
      })}
      <div className="h-px bg-separator my-1" />
    </>
  );
}

/**
 * An app's right-click menu, as menuFor allows it. `act` runs a click as a click on its button does, errors included; `fail` shows
 * what went wrong in the button's label; `move` opens Move to folder's own menu over the same button.
 */
export function AppMenu({ b, act, close, fail, move }: { b: BarButton; act: (c: Click) => void; close: () => void; fail: (text: string) => void; move: () => void }) {
  const endTask = settings.use().taskbar.endTask;
  // An app with an entry pins it; one without asks Rust to pin its window.
  const pin = () =>
    b.pins.length ? togglePin(b.pins[0]) : void taskbar.pinWindow(b.windows[0].id).then(togglePin, () => fail(t("{name} lässt sich nicht anheften", { name: b.name })));
  const entries = {
    launch: [b.name, () => act(newInstance(b))],
    pin: [t("An Taskleiste anheften"), pin],
    unpin: [t("Von Taskleiste lösen"), () => togglePin(b.pin!)],
    move: [t("In Ordner verschieben …"), move],
    out: [t("Aus Ordner nehmen"), () => editPins((p) => takeOut(p, b.pin!.id))],
    reveal: [t("Dateipfad öffnen"), () => void taskbar.reveal(b.windows[0].id).catch(() => {})],
    // Several windows of one process: the calls after the first find it gone and do nothing.
    endTask: [t("Task beenden"), () => b.windows.forEach((win) => void taskbar.window(win.id, "end").catch(() => {}))],
    close: [t("Fenster schließen"), () => closeWindows(b)],
    closeAll: [t("Alle Fenster schließen"), () => closeWindows(b)],
  } as const;
  return (
    <>
      <JumpRows b={b} close={close} fail={fail} />
      {menuFor(b, { endTask }).map((e) => {
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

/**
 * Move to folder's menu for a pinned app: each folder by its name but the one the app is in, which takes it at its end, then New
 * folder, a folder of the app alone at its place, which `created` opens with its name ready to type.
 */
export function MoveMenu({ b, folders, close, created }: { b: BarButton; folders: Folder[]; close: () => void; created: (id: string) => void }) {
  const pin = b.pin!.id;
  return (
    <>
      {folders
        .filter((f) => f.id !== b.inFolder)
        .map((f) => (
          <Row
            key={f.id}
            label={f.name}
            onClick={() => {
              close();
              editPins((p) => intoFolder(p, pin, folderKey(f.id), "", ""));
            }}
          />
        ))}
      <Row
        label={t("Neuer Ordner")}
        onClick={() => {
          close();
          const id = crypto.randomUUID();
          editPins((p) => newFolder(p, pin, id, nextName(p.folders, folderLabel)));
          created(id);
        }}
      />
    </>
  );
}

/** A folder's menu: Rename, which opens it with its name ready to type, and Ungroup apps, which puts its apps back on the bar in its place. */
export function FolderMenu({ id, close, rename }: { id: string; close: () => void; rename: () => void }) {
  return (
    <>
      <Row
        label={t("Umbenennen")}
        onClick={() => {
          close();
          rename();
        }}
      />
      <Row
        label={t("Ordner auflösen")}
        onClick={() => {
          close();
          editPins((p) => ungroup(p, id));
        }}
      />
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
  const autoHide = settings.use().taskbar.autoHide;
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
      <Row label={t("Task-Manager")} onClick={run(() => taskbar.shell("taskmgr"))} />
      <Row label={t("Einstellungen …")} onClick={run(() => settingsWindow.open("taskbar"))} />
      <Row label={t("Widget hinzufügen …")} onClick={run(() => settingsWindow.open("taskbar-widgets"))} />
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
      <Row
        label={t("Automatisch ausblenden")}
        checked={autoHide}
        onClick={() => updateSettings((s) => ({ taskbar: { ...s.taskbar, autoHide: !s.taskbar.autoHide } }))}
      />
      <Row label={t("Crest beenden")} onClick={run(taskbar.quit)} />
    </>
  );
}

/** The Recycle Bin's menu: Open, and Empty while it holds anything, which Windows confirms first. */
export function RecycleMenu({ close }: { close: () => void }) {
  const items = recycleBin.use()?.items ?? 0;
  const run = (action: "open" | "empty") => () => {
    close();
    holdBriefly();
    void taskbar.recycleDo(action).catch(() => {});
  };
  return (
    <>
      <Row label={t("Öffnen")} onClick={run("open")} />
      <Row label={t("Papierkorb leeren")} disabled={!items} onClick={run("empty")} />
    </>
  );
}

const WINDOW_LABEL: Record<WindowEntry, string> = {
  restore: "Wiederherstellen",
  move: "Verschieben",
  size: "Größe ändern",
  minimize: "Minimieren",
  maximize: "Maximieren",
  close: "Schließen",
};

/** One window's menu (Shift+right-click), as Windows' own: each row enabled as the window allows, read as the menu opens. */
export function WindowMenu({ win, close }: { win: Win; close: () => void }) {
  const [state, setState] = useState<WindowState | null>(null);
  useEffect(() => void taskbar.windowMenu(win.id).then(setState, () => {}), [win.id]);
  // The menu focused its only enabled row, Close, as it opened: the keyboard moves to the first one the state enables.
  useEffect(() => void (state && document.querySelector<HTMLElement>(`[role=menu] ${ROWS}`)?.focus({ preventScroll: true })), [state]);
  return (
    <>
      {windowMenuRows(state).map(({ entry, enabled }) => (
        <Row
          key={entry}
          label={t(WINDOW_LABEL[entry])}
          disabled={!enabled}
          onClick={() => {
            close();
            taskbar.window(win.id, entry).catch(() => {});
          }}
        />
      ))}
    </>
  );
}

const GROUP_LABEL: Record<GroupEntry, string> = {
  cascade: "Überlappend",
  stack: "Fenster gestapelt anzeigen",
  side: "Fenster nebeneinander anzeigen",
  restoreAll: "Alle Fenster wiederherstellen",
  minimizeAll: "Alle Fenster minimieren",
  closeAll: "Alle Fenster schließen",
};
const GROUP_HOW = { cascade: "cascade", stack: "stack", side: "side", restoreAll: "restore", minimizeAll: "minimize" } as const;

/** The menu of an app with several windows (Shift+right-click): arranged on this bar's monitor, restored, minimized or closed. */
export function GroupMenu({ b, close }: { b: BarButton; close: () => void }) {
  return (
    <>
      {GROUP_MENU.map((entry) => (
        <Row
          key={entry}
          label={t(GROUP_LABEL[entry])}
          onClick={() => {
            close();
            if (entry === "closeAll") closeWindows(b);
            else
              taskbar.arrange(
                b.windows.map((w) => w.id),
                GROUP_HOW[entry],
              ).catch(() => {});
          }}
        />
      ))}
    </>
  );
}
