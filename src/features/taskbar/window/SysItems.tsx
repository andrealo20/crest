import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BellSimple, Copy, Files, Keyboard, MagnifyingGlass, MapPin, Microphone, Monitor, Moon, SquaresFour, Sun, Translate, Trash, VideoCamera, type Icon } from "../../../ui/iconset";
import { fade, springs } from "../../../design/motion";
import { t } from "../../../i18n";
import { systemDark } from "../../../notch/glass/media";
import { systemControls, taskbar } from "../../../platform/services";
import { privacy } from "../../privacy/store";
import { inputLang, startInput } from "../input";
import { privacyParts, widgetWidth } from "../widgets";
import { recycleName, type SysId } from "../model";
import { recycleBin } from "../store";
import { holdBriefly } from "./hold";
import { Item, type ItemProps } from "./Item";

/** Each of Windows' buttons the bar holds (model.ts SYS_IDS): its name (a key for t()) and its icon, which the settings and the drag's ghost show too. */
export const SYS_INFO: Record<SysId, { label: string; icon: Icon }> = {
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
  recent: { label: "Zuletzt geöffnet", icon: Files },
  searchbox: { label: "Suchen oder öffnen", icon: MagnifyingGlass },
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
 * itself, the Recently opened menu or the search box's field.
 */
export function SysButton({ id, item, dragged, onOpen }: { id: SysId; item: Omit<ItemProps, "onClick" | "children">; dragged: (e: { detail: number }) => boolean; onOpen?: (anchor: HTMLElement) => void }) {
  if (id === "input") return <InputButton item={item} dragged={dragged} />;
  if (id === "privacy") return <PrivacyButton item={item} dragged={dragged} />;
  if (id === "recycle") return <RecycleButton item={item} dragged={dragged} />;
  if (id === "theme") return <ThemeButton item={item} dragged={dragged} />;
  if (id === "searchbox") return <SearchBox item={item} dragged={dragged} onOpen={onOpen} />;
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
            initial={{ opacity: 0, transform: "rotate(-45deg) scale(0.6)" }}
            animate={{ opacity: 1, transform: "rotate(0deg) scale(1)", transition: springs.snappy }}
            exit={{ opacity: 0, transform: "rotate(45deg) scale(0.6)", transition: fade }}
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
      <span aria-hidden className="flex h-6 w-[120px] items-center gap-1.5 rounded-full bg-fill-2 px-2.5" style={{ zoom: k }}>
        <MagnifyingGlass size={14} weight="regular" className="shrink-0 text-label-3" />
        <span className="truncate text-footnote text-label-3">{t("Suchen oder öffnen")}</span>
      </span>
    </Item>
  );
}

/**
 * The input language, as Windows' indicator by the tray: the language over the region ("ITA" over "IT"), nothing while Windows has
 * one keyboard layout. It follows the window in front (taskbar/input.rs); a click opens Windows' switcher, as Win+Space.
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
 * click opens it in Explorer; its menu (TaskbarWindow) empties it through Windows' own confirmation.
 */
function RecycleButton({ item, dragged }: { item: Omit<ItemProps, "onClick" | "children">; dragged: (e: { detail: number }) => boolean }) {
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
        holdBriefly();
        void taskbar.recycleDo("open").catch(() => {});
      }}
    >
      <Trash size={Math.round(item.size * 0.8)} weight={n ? "fill" : "regular"} />
    </Item>
  );
}
