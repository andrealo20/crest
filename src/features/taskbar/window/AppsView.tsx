import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEventHandler, type PointerEvent as ReactPointerEvent } from "react";
import { motion } from "motion/react";
import { popover } from "../../../design/motion";
import { t } from "../../../i18n";
import { launcher } from "../../../platform/services";
import { settings } from "../../../settings/store";
import { Button, Skeleton } from "../../../ui/controls";
import { MENU_PANEL_CLASS, MENU_ROW_CLASS } from "../../../ui/menu";
import { AppIcon } from "../../launcher/AppIcon";
import { aiKey, type LauncherApp } from "../../launcher/apps";
import { launcherApps, loadApps, useIcons } from "../../launcher/store";
import { menuKey } from "../model";
import { closePanel, panel, pinDrag } from "../panel";
import { appRows } from "../panelModel";
import { togglePin } from "./BarMenu";

/** Room the pin menu keeps from the panel's edges, CSS px. */
const EDGE = 8;
/** How far a press on a row moves before it drags the app out, CSS px; less is still a click. */
const DRAG = 4;
/** The ways a press ends without a key. */
const PRESS_ENDS = ["pointerup", "pointercancel", "lostpointercapture"] as const;

/** An open pin menu: its app, and where it opens in the window's px (the pointer, or the selected row's bottom left corner). */
type PinAt = { app: LauncherApp; x: number; y: number };

/**
 * The app menu in the panel above the bar: a search over every Start menu app, and the apps below it under their letters. The
 * search keeps the keyboard and drives the list as a combobox: Up, Down, Home and End move the selected app, Enter starts it, the
 * context-menu key or Shift+F10 opens its pin menu, as a right click on a row does. A started app closes the panel and takes the
 * keyboard itself; one that does not start leaves the panel open with the Launcher's message under the list.
 */
export function AppsView() {
  const { apps, loading, failed } = launcherApps.use();
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState<PinAt | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const optionId = (i: number) => `${id}-${i}`;

  const rows = useMemo(() => (apps ? appRows(apps, query) : []), [apps, query]);
  const options = useMemo(() => rows.flatMap((r) => (r.kind === "app" ? [r.app] : [])), [rows]);
  // A list read again under the same query can be shorter than the place selected in it.
  const at = Math.min(sel, options.length - 1);

  useEffect(() => void loadApps(), []);
  useEffect(() => field.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  // Icons only for the rows in view and 200 px around them, collected as the list scrolls: asking for every app at once would keep
  // Rust's shell busy with a few hundred while the panel opens.
  const [seen, setSeen] = useState<string[]>([]);
  const icons = useIcons(seen);
  useEffect(() => {
    const root = list.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const shown = entries.filter((e) => e.isIntersecting).map((e) => (e.target as HTMLElement).dataset.app!);
        setSeen((s) => {
          const added = shown.filter((app) => !s.includes(app));
          return added.length ? [...s, ...added] : s;
        });
      },
      { root, rootMargin: "200px" },
    );
    root.querySelectorAll("[data-app]").forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [rows]);

  // A press on a row, followed until the pointer lets go: past DRAG it drags the app (pinDrag), which the bar pins where it is let
  // go (TaskbarWindow). The press ends on the release, a cancel, a lost capture, Esc while dragging, or the panel closing; `dragged`
  // outlives it, so the click its release makes starts nothing.
  const endPress = useRef<(() => void) | null>(null);
  const dragged = useRef(false);
  useEffect(() => {
    const off = panel.subscribe(() => panel.get() || endPress.current?.());
    return () => {
      off();
      endPress.current?.();
    };
  }, []);
  const press = (e: ReactPointerEvent<HTMLElement>, app: LauncherApp) => {
    if (e.button !== 0) return;
    const { pointerId, clientX, clientY } = e;
    // The row gets every move and the release, wherever the pointer goes; the window gets them from it, and a capture lost to a
    // row taken out of the list (a search typed meanwhile) reaches the window from the document.
    e.currentTarget.setPointerCapture(pointerId);
    dragged.current = false;
    const onMove = (m: PointerEvent) => {
      if (m.pointerId !== pointerId || (!dragged.current && Math.hypot(m.clientX - clientX, m.clientY - clientY) <= DRAG)) return;
      dragged.current = true;
      pinDrag.set({ app, x: m.clientX, y: m.clientY });
    };
    const onEnd = (m: PointerEvent) => m.pointerId === pointerId && end();
    // Taken on the way down, before the panel's own Esc, which then leaves the panel open.
    const onKey = (k: KeyboardEvent) => {
      if (k.key !== "Escape" || !dragged.current) return;
      k.preventDefault();
      end();
    };
    const end = () => {
      removeEventListener("pointermove", onMove);
      for (const type of PRESS_ENDS) removeEventListener(type, onEnd);
      removeEventListener("keydown", onKey, true);
      endPress.current = null;
      pinDrag.set(null);
    };
    endPress.current?.();
    addEventListener("pointermove", onMove);
    for (const type of PRESS_ENDS) addEventListener(type, onEnd);
    addEventListener("keydown", onKey, true);
    endPress.current = end;
  };

  const start = (app: LauncherApp) => {
    setError(null);
    launcher.open(app.id).then(
      () => closePanel(),
      (code) => setError(t(code === "not-found" ? "{name} ist nicht mehr installiert" : "{name} startet nicht", { name: app.name })),
    );
  };

  // The menu's row had the keyboard: it goes back to the search, where the arrows and Enter work.
  const closePin = useCallback(() => {
    setPin(null);
    field.current?.focus({ preventScroll: true });
  }, []);

  const onKey: KeyboardEventHandler<HTMLInputElement> = (e) => {
    // An Enter that ends an input method's composition belongs to the text.
    if (e.nativeEvent.isComposing) return;
    const app = options[at];
    const row = document.getElementById(optionId(at));
    if (app && e.key === "Enter") {
      e.preventDefault();
      start(app);
    } else if (app && row && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) {
      e.preventDefault();
      // Under its row, brought back into view first if the wheel took the list away from it.
      row.scrollIntoView({ block: "nearest" });
      const r = row.getBoundingClientRect();
      setPin({ app, x: r.left, y: r.bottom });
    } else {
      const to = menuKey(e.key, at, options.length);
      if (to === undefined) return;
      e.preventDefault();
      setSel(to);
      // Only the keyboard scrolls the list to the selected row: the pointer's row is in view, and the list would move under it.
      document.getElementById(optionId(to))?.scrollIntoView({ block: "nearest" });
    }
  };

  // An empty list is a read that went wrong too (loadApps), and once read the list is not read again without Neu einlesen.
  const unreadable = apps ? apps.length === 0 : failed;
  let option = 0;
  return (
    <div className="relative flex h-full flex-col gap-2 p-3">
      <div className="flex h-7 shrink-0 items-center gap-1 rounded-[8px] bg-fill-2 px-2">
        <input
          ref={field}
          role="combobox"
          aria-label={t("Apps durchsuchen")}
          aria-controls={`${id}-list`}
          aria-expanded
          aria-autocomplete="list"
          aria-activedescendant={at >= 0 ? optionId(at) : undefined}
          value={query}
          spellCheck={false}
          autoComplete="off"
          placeholder={t("Apps durchsuchen")}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
            list.current?.scrollTo({ top: 0 });
          }}
          onKeyDown={onKey}
          className="min-w-0 flex-1 bg-transparent text-footnote text-label outline-none placeholder:text-label-4"
        />
      </div>
      {/* A press in the list leaves the keyboard in the search. */}
      <div ref={list} onMouseDown={(e) => e.preventDefault()} className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
        {unreadable ? (
          <div className="flex flex-col items-start gap-2 p-2">
            <span className="text-caption text-label-3">{t("App-Liste nicht lesbar, Neu einlesen versuchen")}</span>
            <Button onClick={() => void loadApps(true)} disabled={loading}>
              {t("Neu einlesen")}
            </Button>
          </div>
        ) : !apps ? (
          [0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex h-9 items-center gap-2.5 px-2">
              <Skeleton className="size-5" />
              <Skeleton className={`h-3 ${i % 2 ? "w-1/3" : "w-1/2"}`} />
            </div>
          ))
        ) : rows.length === 0 ? (
          <div className="p-2 text-caption text-label-3">{t("Keine passende App")}</div>
        ) : null}
        <div id={`${id}-list`} role="listbox" aria-label={t("Apps")}>
          {rows.map((r, k) => {
            if (r.kind === "letter")
              return (
                <div key={`letter ${k}`} aria-hidden className="px-2 pt-2 pb-1 text-caption text-label-3">
                  {r.letter}
                </div>
              );
            const i = option++;
            const a = r.app;
            return (
              <div
                key={a.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === at}
                data-app={a.id}
                onPointerMove={() => setSel(i)}
                onPointerDown={(e) => press(e, a)}
                onClick={() => {
                  if (!dragged.current) start(a);
                }}
                onContextMenu={(e) => {
                  setSel(i);
                  setPin({ app: a, x: e.clientX, y: e.clientY });
                }}
                className={`flex h-9 items-center gap-2.5 rounded-[8px] px-2 ${i === at ? "bg-fill-2" : ""}`}
              >
                <AppIcon src={icons[a.id]} size={20} />
                <span className="min-w-0 flex-1 truncate text-body text-label">{a.name}</span>
                {aiKey(a) && <span className="rounded-full bg-fill-2 px-1.5 text-caption text-label-2">{t("AI")}</span>}
              </div>
            );
          })}
        </div>
      </div>
      {error && (
        <div role="alert" className="truncate px-2 text-caption text-red">
          {error}
        </div>
      )}
      {pin && <PinMenu {...pin} close={closePin} />}
    </div>
  );
}

/**
 * An app's pin menu in the bar's menu look, with the entries of the bar's app menu. It opens inside the panel, where the window
 * takes the pointer, and closes on Esc or on a click anywhere else in the panel; either leaves the panel open.
 */
function PinMenu({ app, x, y, close }: PinAt & { close: () => void }) {
  const pinned = settings.use().taskbar.pinned?.some((p) => p.id === app.id) ?? false;
  const ref = useRef<HTMLDivElement>(null);

  // Placed before it shows, in the panel's own px (the panel is drawn at Crest's scale, the point is in the window's px), and
  // moved back in by what would stick out of the panel.
  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const r = box.getBoundingClientRect();
    const zoom = box.currentCSSZoom;
    const inside = (at: number, size: number, room: number) => Math.max(EDGE, Math.min(at, room - size - EDGE));
    el.style.left = `${inside((x - r.left) / zoom, el.offsetWidth, box.offsetWidth)}px`;
    el.style.top = `${inside((y - r.top) / zoom, el.offsetHeight, box.offsetHeight)}px`;
  }, [x, y]);

  useEffect(() => {
    ref.current?.querySelector("button")?.focus({ preventScroll: true });
    // Taken on the way down, before the panel's own Esc, which leaves an Esc taken here alone.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close();
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [close]);

  return (
    <>
      {/* Rows fill most of the panel: a click to put the menu away would otherwise start the app under it. */}
      <div className="absolute inset-0" onClick={close} onContextMenu={close} />
      <motion.div
        ref={ref}
        role="menu"
        aria-label={app.name}
        className={`${MENU_PANEL_CLASS.replace("fixed", "absolute")} w-max max-w-80 min-w-40`}
        style={{ transformOrigin: "0 0" }}
        initial={{ opacity: 0, transform: "scale(0.96) translateY(-2px)" }}
        animate={{ opacity: 1, transform: "scale(1) translateY(0px)", transition: popover.enter }}
      >
        <button
          role="menuitem"
          onClick={() => {
            togglePin(app);
            close();
          }}
          className={`${MENU_ROW_CLASS} text-label outline-none focus-visible:bg-fill-2`}
        >
          <span className="truncate">{pinned ? t("Lösen") : t("Anheften")}</span>
        </button>
      </motion.div>
    </>
  );
}
