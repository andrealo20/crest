import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BellSimple, BellSimpleSlash, Broadcast, Copy, DotsNine, Eject, Files, Keyboard, MagnifyingGlass, MapPin, Microphone, Monitor, Moon, Sparkle, SquaresFour, Sun, Translate, Trash, VideoCamera, type Icon } from "../../../ui/iconset";
import { fade, pulse, springs } from "../../../design/motion";
import { t } from "../../../i18n";
import { systemDark } from "../../../notch/glass/media";
import { systemControls, taskbar, type Hotspot } from "../../../platform/services";
import { privacy } from "../../privacy/store";
import { inputLang, startInput } from "../input";
import { privacyParts, widgetWidth } from "../widgets";
import { recycleName, type SysId } from "../model";
import { barShown, recycleBin } from "../store";
import { HOTSPOT_EVERY, HOVER_GAP, deskIconsName, deskIconsNote, ejectName, hotspotName, hotspotNote, hotspotOpens } from "../toggles";
import { DndButton } from "./DndButton";
import { readRemovables, removables } from "./EjectMenu";
import { holdBriefly } from "./hold";
import { Item, type ItemProps } from "./Item";

/** Each of Windows' buttons the bar holds (model.ts SYS_IDS): its name (a key for t()) and its icon, which the settings and the drag's ghost show too. */
export const SYS_INFO: Record<SysId, { label: string; icon: Icon }> = {
  // A plain lens: the search box carries the AI sparkles, and the two must not be taken for each other.
  search: { label: "Suchen", icon: MagnifyingGlass },
  taskview: { label: "Aufgabenansicht", icon: Copy },
  widgets: { label: "Windows-Widgets", icon: SquaresFour },
  desktop: { label: "Desktop anzeigen", icon: Monitor },
  input: { label: "Eingabesprache", icon: Translate },
  privacy: { label: "Datenschutzanzeigen", icon: Microphone },
  recycle: { label: "Papierkorb", icon: Trash },
  theme: { label: "Dunkles Design", icon: Moon },
  keyboard: { label: "Bildschirmtastatur", icon: Keyboard },
  notifications: { label: "Benachrichtigungscenter", icon: BellSimple },
  dnd: { label: "Nicht stören", icon: BellSimpleSlash },
  recent: { label: "Zuletzt geöffnet", icon: Files },
  searchbox: { label: "Suchen oder öffnen", icon: Sparkle },
  deskicons: { label: "Desktopsymbole", icon: DotsNine },
  eject: { label: "USB-Laufwerk auswerfen", icon: Eject },
  hotspot: { label: "Mobiler Hotspot", icon: Broadcast },
};

/** The privacy button's glyph, name and Windows' settings page for each use. */
const PRIVACY = {
  mic: { icon: Microphone, name: "Mikrofon wird verwendet", page: "microphone" },
  camera: { icon: VideoCamera, name: "Kamera wird verwendet", page: "camera" },
  location: { icon: MapPin, name: "Standort wird verwendet", page: "location" },
} as const;

/** As the clock's lines (BarClock), two of them in the bar's height. */
const LINE = "block whitespace-nowrap text-center text-footnote leading-tight font-medium text-label";

/**
 * One of Windows' buttons. Search, Task view, Windows widgets, the On-Screen Keyboard, the notification centre and Recently opened
 * are an icon each, grown as Start is; Show desktop is a narrow sliver with a 1 px line on its leading edge, as Windows' corner,
 * without magnifying and without a name above it (a screen reader still reads it). A click opens Windows' own (start.rs
 * `taskbar_shell`, the notification centre as the other bars' clock opens it), the bar held up while it comes to the front; Windows
 * may refuse, and nothing changes then. `dragged` says the click is a drag's release; `onOpen` opens what a button shows over
 * itself, the Recently opened menu, Eject's menu or the search box's field; `say` puts a note, or what went wrong, in the label above
 * the button.
 */
export function SysButton({ id, item, dragged, onOpen, say }: {
  id: SysId;
  item: Omit<ItemProps, "onClick" | "children">;
  dragged: (e: { detail: number }) => boolean;
  onOpen?: (anchor: HTMLElement, keyboard?: boolean) => void;
  say: (text: string, failed: boolean) => void;
}) {
  if (id === "input") return <InputButton item={item} dragged={dragged} />;
  if (id === "privacy") return <PrivacyButton item={item} dragged={dragged} />;
  if (id === "recycle") return <RecycleButton item={item} dragged={dragged} onOpen={onOpen} />;
  if (id === "theme") return <ThemeButton item={item} dragged={dragged} />;
  if (id === "searchbox") return <SearchBox item={item} dragged={dragged} onOpen={onOpen} />;
  if (id === "dnd") return <DndButton item={item} dragged={dragged} />;
  if (id === "deskicons") return <DeskIconsButton item={item} dragged={dragged} say={say} />;
  if (id === "eject") return <EjectButton item={item} dragged={dragged} onOpen={onOpen} />;
  if (id === "hotspot") return <HotspotButton item={item} dragged={dragged} say={say} />;
  const I = SYS_INFO[id].icon;
  const narrow = Math.round(item.size / 2);
  return (
    <Item
      {...item}
      {...(id === "desktop" && { label: null, magnify: undefined, width: narrow })}
      onClick={(e) => {
        if (dragged(e)) return;
        // Its menu reads the list as it opens, over the button.
        if (id === "recent") return onOpen?.(e.currentTarget);
        holdBriefly();
        void (id === "notifications" ? taskbar.calendar() : taskbar.shell(id)).catch(() => {});
      }}
    >
      {id === "desktop" ? <span aria-hidden className="border-s border-separator" style={{ width: narrow, height: Math.round(item.size * 0.75) }} /> : <I size={Math.round(item.size * 0.8)} weight="regular" />}
    </Item>
  );
}

/**
 * Windows' dark mode: a sun while Windows is light, a moon while it is dark, as Windows' own setting reads (the WebView follows it, no
 * poll). A click turns Windows and its apps dark or light, as Settings, Colours does (quick.rs `quick_dark`); the glyph turns once
 * Windows says it changed. Its name says what the click does.
 */
function ThemeButton({ item, dragged }: { item: Omit<ItemProps, "onClick" | "children">; dragged: (e: { detail: number }) => boolean }) {
  const dark = systemDark.use();
  const size = Math.round(item.size * 0.8);
  // MotionConfig keeps a transform string, so reduced motion picks no turn here, as BarMenu does: a plain crossfade.
  const reduced = useReducedMotion() === true;
  const away = (deg: number) => (reduced ? "rotate(0deg) scale(1)" : `rotate(${deg}deg) scale(0.6)`);
  return (
    <Item
      {...item}
      name={t(dark ? "Helles Design einschalten" : "Dunkles Design einschalten")}
      onClick={(e) => {
        if (dragged(e)) return;
        void systemControls.setDark(!dark).catch(() => {});
      }}
    >
      {/* One cell: the old glyph turns away as the new one turns in over it. */}
      <span className="grid">
        <AnimatePresence initial={false}>
          <motion.span
            key={dark ? "moon" : "sun"}
            className="col-start-1 row-start-1 flex"
            initial={{ opacity: 0, transform: away(-45) }}
            animate={{ opacity: 1, transform: "rotate(0deg) scale(1)", transition: springs.snappy }}
            exit={{ opacity: 0, transform: away(45), transition: fade }}
          >
            {dark ? <Moon size={size} weight="regular" /> : <Sun size={size} weight="regular" />}
          </motion.span>
        </AnimatePresence>
      </span>
    </Item>
  );
}

/**
 * The search box: a 120 px field drawn on the bar, sized with the bar's icons as a widget is (zoom), which only lifts. A click opens the
 * real field in the panel over it (SearchPanel), where typing goes.
 */
function SearchBox({ item, dragged, onOpen }: { item: Omit<ItemProps, "onClick" | "children">; dragged: (e: { detail: number }) => boolean; onOpen?: (anchor: HTMLElement) => void }) {
  const k = item.size / 24;
  return (
    <Item
      {...item}
      magnify={undefined}
      width={widgetWidth(120, k, null)}
      onClick={(e) => {
        if (dragged(e)) return;
        onOpen?.(e.currentTarget);
      }}
    >
      <SearchBoxFace k={k} />
    </Item>
  );
}

/** The search box as the bar draws it, the Widgets page's preview too: a pill with the AI sparkles, `k` the widgets' scale. */
export function SearchBoxFace({ k }: { k: number }) {
  return (
    <span aria-hidden className="flex h-6 w-[120px] items-center gap-1.5 rounded-full bg-fill-2 px-2.5" style={{ zoom: k }}>
      <Sparkle size={14} weight="fill" className="shrink-0 text-accent material:text-primary" />
      <span className="truncate text-footnote text-label-3">{t("Suchen oder öffnen")}</span>
    </span>
  );
}

/**
 * The input language, as Windows' indicator by the tray: the language over the region ("ITA" over "IT"), nothing while Windows has
 * one keyboard layout and it is not Chinese, Japanese or Korean. It follows the window in front (taskbar/input.rs); a click opens Windows' switcher, as Win+Space.
 */
function InputButton({ item, dragged }: { item: Omit<ItemProps, "onClick" | "children">; dragged: (e: { detail: number }) => boolean }) {
  useEffect(() => startInput(), []);
  const lang = inputLang.use();
  if (!lang) return null;
  return (
    <Item
      {...item}
      name={t("Eingabesprache: {lang}", { lang: lang.lang })}
      magnify={undefined}
      onClick={(e) => {
        if (dragged(e)) return;
        holdBriefly();
        void taskbar.shell("input").catch(() => {});
      }}
    >
      <span aria-hidden className="block">
        <span className={LINE}>{lang.lang}</span>
        <span className={LINE}>{lang.region}</span>
      </span>
    </Item>
  );
}

/**
 * The microphone, the camera and the location while an app uses them, as Windows' icons by the tray; nothing while none is. The notch
 * polls them (privacy/store.ts) and the bar follows. A click opens Windows' privacy page of the first.
 */
function PrivacyButton({ item, dragged }: { item: Omit<ItemProps, "onClick" | "children">; dragged: (e: { detail: number }) => boolean }) {
  const parts = privacyParts(privacy.use());
  if (!parts.length) return null;
  const size = Math.round(item.size * 0.7);
  return (
    <Item
      {...item}
      name={parts.map((p) => t(PRIVACY[p].name)).join(", ")}
      magnify={undefined}
      width={parts.length * size + 16}
      onClick={(e) => {
        if (dragged(e)) return;
        holdBriefly();
        void taskbar.settings(PRIVACY[parts[0]].page).catch(() => {});
      }}
    >
      <span aria-hidden className="flex">
        {parts.map((p) => {
          const I = PRIVACY[p].icon;
          return <I key={p} size={size} weight="regular" />;
        })}
      </span>
    </Item>
  );
}

/**
 * The Recycle Bin, empty or full, with its count in its name; Rust sends a new count when the shell reports a change (recycle.rs). A
 * click opens or closes its confirmation above the bar (RecyclePanel), whose red button alone empties it; its menu (TaskbarWindow)
 * opens it too.
 */
function RecycleButton({ item, dragged, onOpen }: {
  item: Omit<ItemProps, "onClick" | "children">;
  dragged: (e: { detail: number }) => boolean;
  onOpen?: (anchor: HTMLElement, keyboard?: boolean) => void;
}) {
  useEffect(() => {
    const off = taskbar.onRecycle(recycleBin.set);
    taskbar.recycle().then((r) => r && recycleBin.set(r), () => {});
    return off;
  }, []);
  const n = recycleBin.use()?.items ?? null;
  const [key, values] = recycleName(n);
  return (
    <Item
      {...item}
      name={t(key, values)}
      onClick={(e) => {
        if (dragged(e)) return;
        onOpen?.(e.currentTarget, e.detail === 0);
      }}
    >
      <Trash size={Math.round(item.size * 0.8)} weight={n ? "fill" : "regular"} />
    </Item>
  );
}

/** A switch shown off, or a button with nothing to act on: its glyph at this opacity. */
const DIM = 0.4;

/**
 * A state of Windows the button reads itself, as Windows tells Crest nothing when it changes: `read` as the button mounts, again as
 * the pointer comes over it at most every HOVER_GAP, so the look is right before a click, and on `again` after one. No timer.
 * `read` must be the same function at every render.
 */
function useWindowsRead(read: () => unknown, onEnter: ItemProps["onEnter"]): [again: () => void, onEnter: ItemProps["onEnter"]] {
  const at = useRef(0);
  const again = useCallback(() => {
    at.current = Date.now();
    read();
  }, [read]);
  useEffect(again, [again]);
  return [
    again,
    (e) => {
      onEnter(e);
      if (Date.now() - at.current >= HOVER_GAP) again();
    },
  ];
}

/** A glyph that fades to `opacity`, or with `pulsing` goes back and forth between full and dimmed (held at 0.6 with reduced motion). */
function Glyph({ opacity, pulsing = false, children }: { opacity: number; pulsing?: boolean; children: ReactNode }) {
  const reduced = useReducedMotion() === true;
  const animate = !pulsing ? { opacity } : reduced ? { opacity: 0.6 } : { opacity: [1, DIM] };
  return (
    <motion.span className="flex" initial={false} animate={animate} transition={pulsing && !reduced ? pulse : fade}>
      {children}
    </motion.span>
  );
}

/**
 * The desktop's icons, as the desktop menu's Show desktop icons (toggles.rs): the glyph full while they show, dimmed while hidden or
 * not read. Its name says what the click does; a click not read yet tries to hide them.
 */
function DeskIconsButton({ item, dragged, say }: { item: Omit<ItemProps, "onClick" | "children">; dragged: (e: { detail: number }) => boolean; say: (text: string, failed: boolean) => void }) {
  const [shown, setShown] = useState<boolean | null>(null);
  const read = useCallback(() => taskbar.desktopIcons().then(setShown, () => setShown(null)), []);
  const [again, onEnter] = useWindowsRead(read, item.onEnter);
  return (
    <Item
      {...item}
      name={deskIconsName(shown, t)}
      onEnter={onEnter}
      onClick={(e) => {
        if (dragged(e)) return;
        holdBriefly();
        void taskbar
          .desktopIconsSet(shown === false)
          .catch((code) => say(deskIconsNote(code, t), true))
          .finally(again);
      }}
    >
      <Glyph opacity={shown ? 1 : DIM}>
        <DotsNine size={Math.round(item.size * 0.8)} weight="regular" />
      </Glyph>
    </Item>
  );
}

/**
 * Eject, always on the main bar: dimmed, and its name and the label over it say so, while no drive that plugs in is there. A click
 * opens its menu of drives (EjectMenu), never ejecting one by itself.
 */
function EjectButton({ item, dragged, onOpen }: { item: Omit<ItemProps, "onClick" | "children">; dragged: (e: { detail: number }) => boolean; onOpen?: (anchor: HTMLElement) => void }) {
  const list = removables.use();
  const [, onEnter] = useWindowsRead(readRemovables, item.onEnter);
  const name = ejectName(list, t);
  return (
    <Item
      {...item}
      name={name}
      // A note or an error over the button still wins over its name.
      hoverLabel={name}
      onEnter={onEnter}
      onClick={(e) => {
        if (dragged(e)) return;
        onOpen?.(e.currentTarget);
      }}
    >
      <Glyph opacity={list && !list.length ? DIM : 1}>
        <Eject size={Math.round(item.size * 0.8)} weight="regular" />
      </Glyph>
    </Item>
  );
}

/**
 * The mobile hotspot (toggles.rs): full while on, dimmed while off or unusable, pulsing while Windows switches it or a click waits.
 * Read as the others, and while it is on and the bar shows every HOTSPOT_EVERY too. A click turns it on or off, as the quick
 * settings' tile does, without asking: sharing the connection is what the click asks for. Unusable, or never read, the click opens
 * Windows' Mobile hotspot page instead.
 */
function HotspotButton({ item, dragged, say }: { item: Omit<ItemProps, "onClick" | "children">; dragged: (e: { detail: number }) => boolean; say: (text: string, failed: boolean) => void }) {
  const [spot, setSpot] = useState<Hotspot | null>(null);
  const [asking, setAsking] = useState(false);
  const read = useCallback(() => taskbar.hotspot().then(setSpot, () => setSpot(null)), []);
  const [again, onEnter] = useWindowsRead(read, item.onEnter);
  const shown = barShown.use();
  const on = spot?.state === "on";
  useEffect(() => {
    if (!on || !shown) return;
    const id = window.setInterval(again, HOTSPOT_EVERY);
    return () => window.clearInterval(id);
  }, [on, shown, again]);
  return (
    <Item
      {...item}
      name={hotspotName(spot, t)}
      onEnter={onEnter}
      onClick={(e) => {
        if (dragged(e)) return;
        if (hotspotOpens(spot)) {
          holdBriefly();
          return void taskbar.settings("hotspot").catch(() => {});
        }
        setAsking(true);
        void taskbar
          .hotspotSet(!on)
          .catch((code) => say(hotspotNote(code, t), true))
          .finally(() => {
            setAsking(false);
            again();
          });
      }}
    >
      <Glyph opacity={on ? 1 : DIM} pulsing={asking || spot?.state === "turning"}>
        <Broadcast size={Math.round(item.size * 0.8)} weight="regular" />
      </Glyph>
    </Item>
  );
}
