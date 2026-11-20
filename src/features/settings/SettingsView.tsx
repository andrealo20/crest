import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, LayoutGroup, motion, Reorder, useReducedMotion, type MotionStyle, type Variants } from "motion/react";
import {
  AppWindow,
  ArrowsInLineHorizontal,
  BellSimple,
  CheckCircle,
  Columns,
  DotsSixVertical,
  Keyboard,
  LockSimple,
  MagnifyingGlass,
  Monitor,
  PaintBrush,
  Palette,
  Play,
  Plugs,
  PuzzlePiece,
  Bug,
  SlidersHorizontal,
  Sparkle,
  SquaresFour,
  SignOut,
  Stop,
  Timer,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { design } from "../../design/design";
import { content, fade, springs } from "../../design/motion";
import { alarmSounds, playAlarm, type AlarmDuration } from "../../lib/sound";
import { createStore } from "../../lib/store";
import { nav, navigate } from "../../notch/nav";
import { findTab, setupTab } from "../../notch/tabs";
import { PluginSettings } from "../plugins/PluginSettings";
import { plugins } from "../plugins/store";
import {
  autostart,
  build,
  display,
  openSponsors,
  openBugReport,
  openStoreReview,
  portable,
  secrets,
  systemDiagnostics,
  unlockFps,
  type MonitorInfo,
  type SecretName,
} from "../../platform/services";
import { BackupSettings } from "./BackupSettings";
import { diagnosticsText } from "./diagnostics";
import { cascades, shellLayout, showsHeaderTitle } from "./shell";
import { cascadeDelay } from "../../ui/cascade";
import { searchSettings, type SearchEntry } from "./search";
import { github } from "../github/store";
import { leetcode } from "../leetcode/store";
import { settings, updateAsk, updateSettings, type AskProvider } from "../../settings/store";
import { Button, Group, RoomyContext, Row, Segmented, Select, Slider, StyleCards, SubSwitch, Switch, TextField } from "../../ui/controls";
import type { RowSymbol } from "../../ui/materialNames";
import { PET_IDS, PET_SIZE, type ClosedSettings, type PartId, type PetId } from "../../notch/row/parts";
import { partInfo } from "../../notch/row/partInfo";
import { PetArt } from "../../notch/pet/Nest";
import { PET_NAMES } from "../../notch/pet/art";
import { effortLevels, providerInfo } from "../ask/providers";
import { discordState, reconnectDiscord } from "../discord/store";
import { fps, useFpsPolling } from "../system/gaming";
import { PlaceSearch } from "../weather/WeatherView";
import { VaultSettings } from "../vault/VaultSettings";
import { ClockLookSettings, TimerLookSettings } from "../timer/LookSettings";
import { focusSounds, type FocusSound } from "../timer/focusSound";
import { ProductivitySettings } from "../water/WaterSettings";
import { BreaksSettings } from "../breaks/BreaksSettings";
import { TerminalSettings } from "../terminal/TerminalSettings";
import { MusicSettings } from "../now-playing/MusicSettings";
import { setMusic } from "../now-playing/music";
import { UsageSettings } from "../usage/UsageSettings";
import { SystemSettings } from "../system/SystemSettings";
import { LauncherSettings } from "../launcher/LauncherSettings";
import { GithubSettings } from "../github/GithubSettings";
import { LeetcodeSettings } from "../leetcode/LeetcodeSettings";
import { CalendarSettings } from "../calendar/CalendarSettings";
import { NoticesSettings } from "../notices/NoticesSettings";
import { WindowSettings, keyText } from "../window/WindowSettings";
import { keycaps } from "../window/hotkeys";
import { hotkeyStatus } from "../window/store";
import { TradingSettings } from "../trading/TradingSettings";
import { detectPlace } from "../weather/store";
import { checkForUpdate, installUpdate, update } from "../../lib/update";
import { across } from "../../notch/edge";
import { EdgeSettings } from "../../notch/EdgeSettings";
import { SizeSettings } from "../../notch/SizeSettings";
import { PortableNote } from "../portable/PortableNote";
import { between, changelog, markSeen, useUnseen } from "../../lib/changelog";
import { privacy, togglePresentation, usePresenting } from "../privacy/store";
import { english, LANGUAGE_NAMES, LANGUAGES, t, tBackend, type LanguageSetting } from "../../i18n";
import { ChangelogList } from "../whatsnew/ChangelogList";
import { isMac } from "../../platform/native";
import { ThemeSettings } from "../themes/ThemeSettings";
import { HideFromSharingRow } from "../meeting/HideFromSharingRow";
import { hueVar, useIconColors, type Hue } from "../themes/hues";
import { HUE_PILL } from "../themes/themes";
import { ClipboardSettings } from "../clipboard/ClipboardSettings";
import { TaskbarApps, TaskbarGeneral, TaskbarItems, TaskbarLook, useTaskbarShown } from "../taskbar/TaskbarSettings";
import { WidgetsPage } from "../taskbar/WidgetsPage";

type PageId = "general" | "display" | "window" | "tools" | "timer" | "ai" | "accounts" | "themes" | "notices" | "plugins" | "taskbar" | "taskbar-items" | "taskbar-widgets" | "taskbar-apps" | "taskbar-look";

const allPages: { id: PageId; label: string; icon: Icon; hue: Hue }[] = [
  { id: "general", label: "Allgemein", icon: SlidersHorizontal, hue: "slate" },
  { id: "display", label: "Darstellung", icon: Monitor, hue: "blue" },
  { id: "window", label: "Fenster", icon: AppWindow, hue: "indigo" },
  { id: "tools", label: "Tools", icon: SquaresFour, hue: "orange" },
  { id: "timer", label: "Timer", icon: Timer, hue: "amber" },
  { id: "ai", label: "AI", icon: Sparkle, hue: "violet" },
  { id: "accounts", label: "Verbindungen", icon: Plugs, hue: "teal" },
  { id: "themes", label: "Themen", icon: Palette, hue: "pink" },
  { id: "notices", label: "Mitteilungen", icon: BellSimple, hue: "red" },
  { id: "plugins", label: "Plugins", icon: PuzzlePiece, hue: "green" },
  { id: "taskbar", label: "Allgemein", icon: SlidersHorizontal, hue: "slate" },
  { id: "taskbar-items", label: "Elemente", icon: Columns, hue: "blue" },
  { id: "taskbar-widgets", label: "Widgets", icon: SquaresFour, hue: "teal" },
  { id: "taskbar-apps", label: "Apps und Fenster", icon: AppWindow, hue: "indigo" },
  { id: "taskbar-look", label: "Aussehen", icon: PaintBrush, hue: "pink" },
];

/** The settings window's switch shows one scope's pages: the notch's, with those of the whole app, or the taskbar's. */
type Scope = "notch" | "taskbar";
const scopeOf = (page: PageId): Scope => (page.startsWith("taskbar") ? "taskbar" : "notch");

/** Deep links from other tools (`navigate("settings", "<section>")`) → page holding that section. */
const sectionPage: Record<string, PageId> = {
  weather: "general",
  updates: "general",
  display: "display",
  presentation: "display",
  window: "window",
  alarm: "timer",
  ask: "ai",
  usage: "ai",
  discord: "accounts",
  trading: "accounts",
  vault: "tools",
  todos: "tools",
  water: "tools",
  terminal: "tools",
  themes: "themes",
  design: "themes",
  system: "tools",
  launcher: "tools",
  github: "accounts",
  leetcode: "accounts",
  calendar: "accounts",
  notices: "notices",
  plugins: "plugins",
  taskbar: "taskbar",
  "taskbar-items": "taskbar-items",
  "taskbar-widgets": "taskbar-widgets",
  "taskbar-apps": "taskbar-apps",
  "taskbar-look": "taskbar-look",
};

/**
 * The open scope and the last page of each, which the settings window's switch reads and sets. They survive closing/opening the
 * notch (the component is rebuilt).
 */
export const savedPage = createStore<{ scope: Scope } & Record<Scope, PageId>>({ scope: "notch", notch: "general", taskbar: "taskbar" });

/** Opens a page, which becomes the last one of its scope. */
function openPage(page: PageId) {
  const scope = scopeOf(page);
  savedPage.set((s) => ({ ...s, scope, [scope]: page }));
}

// A section asked for opens its page as it comes, so a view built after it shows that page from its first frame (the settings
// window gets its first section while it loads). The view scrolls to the section.
nav.subscribe(() => {
  const page = sectionPage[nav.get().section ?? ""];
  if (!page) return;
  linkedPage = page;
  openPage(page);
});

/** The page a deep link opened last, until a click opens one: a page opened at its section does not cascade (6.11). */
let linkedPage: PageId | null = null;

type Hit = SearchEntry & { page: PageId; groupId: string };

const textOf = (el: Node | null | undefined) => el?.textContent?.trim() ?? "";
/** The Row whose label and group a hit names, inside `root`. */
const findRow = (root: Element, h: Hit) =>
  [...root.querySelectorAll<HTMLElement>("[data-row]")].find((r) => textOf(r.querySelector("[data-row-label]")) === h.label && (r.closest("section")?.id ?? "") === h.groupId);

/** Every Row of the pages rendered under `root` (one `data-page` wrapper each), with its group's title and the English texts. */
function readRows(root: HTMLElement): Hit[] {
  const seen = new Set<string>();
  return [...root.querySelectorAll<HTMLElement>("[data-page]")].flatMap((pageEl) =>
    [...pageEl.querySelectorAll("[data-row]")].flatMap((row) => {
      const page = pageEl.dataset.page as PageId;
      const section = row.closest("section");
      const groupId = section?.id ?? "";
      const label = textOf(row.querySelector("[data-row-label]"));
      const key = `${page}|${groupId}|${label}`;
      if (!label || seen.has(key)) return [];
      seen.add(key);
      // A hint can be several texts (a description and a warning under it): each is an entry of its own, read and put into English apart.
      const hints = [...(row.querySelector("[data-row-hint]")?.childNodes ?? [])].map(textOf).filter(Boolean);
      const group = textOf(section?.querySelector(":scope > h3"));
      return [{ page, groupId, label, hint: hints.join(" "), group, en: { label: english(label), hint: hints.map(english).filter(Boolean).join(" "), group: english(group) } }];
    }),
  );
}

/** The settings window's own actions, which Material draws in the page's header instead of the window's title row. */
type Chrome = { onClose: () => void; onDrag: (e: React.MouseEvent) => void; center?: ReactNode };

/** A page's groups wait for the cascade's labels, and start one after another. */
const PAGE_CASCADE = { shown: { transition: { delayChildren: cascadeDelay } } } satisfies Variants;

/**
 * Settings like macOS: categories on the left, only their content on the right.
 * Other tools jump straight to their section via `navigate("settings", "<section>")`.
 */
export function SettingsView({ chrome }: { chrome?: Chrome }) {
  const deepLink = nav.use();
  const saved = savedPage.use();
  const taskbarShown = useTaskbarShown();
  const material = design.use() === "material";
  const reduced = useReducedMotion() === true;
  // Plugin pages are served over http://crestplugin.localhost, which only works on Windows, and live notices have no Mac
  // version (the tool is in WINDOWS_ONLY, src/notch/tabs.ts). The Taskbar's pages show only where the bar can run.
  const pages = allPages.filter((p) => (scopeOf(p.id) === "taskbar" ? taskbarShown : !(isMac && (p.id === "plugins" || p.id === "notices"))));
  // A page the list does not show (the Taskbar's, once they hide) falls back to General.
  const page = pages.some((p) => p.id === saved[saved.scope]) ? saved[saved.scope] : "general";
  const iconColors = useIconColors();
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(820);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [rows, setRows] = useState<Hit[]>([]);
  const [target, setTarget] = useState<Hit | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const hidden = useRef<HTMLDivElement>(null);
  const searching = query.trim() !== "";
  const results = searching ? searchSettings(rows, query) : [];
  const layout = material ? shellLayout(width) : "list";
  // In the rail and the row on top the search is a button, which opens the field.
  const compact = layout !== "list";
  const fieldShown = !compact || searchOpen || searching;

  // Decided once when the page shown changes, so a later render cannot take the labels away from groups still rising. Back from
  // the search to the same page is not a change of page.
  const viewKey = searching ? "search" : page;
  let [view, setView] = useState({ key: viewKey, page, cascade: false });
  if (view.key !== viewKey) {
    const changed = !searching && page !== view.page;
    const aimed = target?.page === page || linkedPage === page;
    view = { key: viewKey, page: searching ? view.page : page, cascade: changed && cascades({ material, reduced, searching, target: aimed }) };
    setView(view);
  }

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [material]);

  // The index is the real pages, rendered hidden while searching and read again on every keystroke, so it never goes stale.
  useLayoutEffect(() => {
    if (searching && hidden.current) setRows(readRows(hidden.current));
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rows that wait for data (monitors, vault, plugins) join the hidden pages after the first read.
  useEffect(() => {
    const root = hidden.current;
    if (!searching || !root) return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setRows(readRows(root)));
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [searching]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "f") return;
      e.preventDefault();
      // A field not shown yet takes the focus as it mounts (autoFocus).
      setSearchOpen(true);
      field.current?.focus();
      field.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const show = (p: PageId) => {
    setQuery("");
    setSearchOpen(false);
    linkedPage = null;
    openPage(p);
  };

  const openHit = (h: Hit) => {
    show(h.page);
    setTarget(h);
  };

  useEffect(() => {
    if (!target) return;
    // Like the deep link below: the row only exists after the page switch.
    const id = window.setTimeout(() => {
      // Spent once it has scrolled: a target left set would keep every later change of page out of the cascade.
      setTarget(null);
      const box = scroller.current;
      const row = box && findRow(box, target);
      if (!row) return;
      const group = row.closest("section");
      const fits = !!group && row.getBoundingClientRect().bottom - group.getBoundingClientRect().top <= box.clientHeight;
      (fits ? group : row).scrollIntoView({ behavior: "smooth", block: fits ? "start" : "center" });
      row.animate([{ backgroundColor: "var(--color-fill-3)" }, { backgroundColor: "var(--color-fill-3)", offset: 0.4 }, { backgroundColor: "transparent" }], { duration: 1600, easing: "ease-out" });
    }, 120);
    return () => window.clearTimeout(id);
  }, [target]);

  // On the nav object, not the section: the same section asked for again scrolls again (the settings window stays open).
  useEffect(() => {
    const { section } = deepLink;
    if (!section || !sectionPage[section]) return;
    // The section only exists after the page switch (openPage, from the nav subscription above).
    const id = window.setTimeout(
      () => scroller.current?.querySelector<HTMLElement>(`#settings-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
      120,
    );
    return () => window.clearTimeout(id);
  }, [deepLink]);

  const input = (
    <input
      ref={field}
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !query) return;
        // Esc clears first; only an empty field lets it through to close the notch.
        e.stopPropagation();
        setQuery("");
      }}
      onBlur={(e) => !e.currentTarget.value && setSearchOpen(false)}
      autoFocus={compact}
      placeholder={t("Suchen")}
      aria-label={t("Suchen")}
      spellCheck={false}
      className={`min-w-0 flex-1 bg-transparent text-label outline-none ${material ? "text-body placeholder:text-label-3" : "text-footnote placeholder:text-label-4"}`}
    />
  );
  const searchPill = (place: string) => (
    <label className={`flex h-10 shrink-0 items-center gap-2.5 rounded-full bg-fill-2 px-3.5 text-label-2 focus-within:ring-2 focus-within:ring-primary ${place}`}>
      <MagnifyingGlass size={20} className="shrink-0" />
      {input}
    </label>
  );

  const scopePages = pages.filter((p) => scopeOf(p.id) === scopeOf(page));
  // Material's items: pills with their name in the list, round icons in the rail and the row on top.
  const item = compact ? "size-10 shrink-0 justify-center" : "h-12 shrink gap-3 px-3 text-start text-body font-medium";
  const materialNav = (
    <>
      {compact ? (
        <button aria-label={t("Suchen")} title={t("Suchen")} onClick={() => setSearchOpen(true)} className="pressable flex size-10 shrink-0 items-center justify-center rounded-full text-label-2">
          <MagnifyingGlass size={20} />
        </button>
      ) : (
        searchPill("mb-2 w-full")
      )}
      {scopePages.map((p) => {
        const active = p.id === page && !searching;
        const name = t(p.label);
        return (
          <button
            key={p.id}
            onClick={() => show(p.id)}
            aria-current={active ? "page" : undefined}
            aria-label={compact ? name : undefined}
            title={compact ? name : undefined}
            className={`pressable relative flex items-center rounded-full ${item} ${active ? "text-on-secondary-container" : "text-label-2"}`}
          >
            {active && (
              <motion.span
                layoutId="settings-page"
                className="absolute inset-0 rounded-full bg-secondary-container"
                style={iconColors ? { background: hueVar(p.hue), opacity: HUE_PILL } : undefined}
                transition={springs.snappy}
              />
            )}
            <p.icon size={20} weight={active ? "fill" : "bold"} className="relative shrink-0" style={iconColors ? { color: hueVar(p.hue) } : undefined} />
            {!compact && <span className="relative">{name}</span>}
          </button>
        );
      })}
      {/* Still the last item, the way people reach Andrea; its name wraps in the long languages. */}
      <button
        onClick={openBugReport}
        aria-label={compact ? t("Fehler melden") : undefined}
        title={compact ? t("Fehler melden") : t("Öffnet das Formular auf GitHub, mit deiner Crest-Version schon eingetragen")}
        className={`pressable relative flex items-center rounded-full text-label-2 ${item}`}
      >
        <Bug size={20} weight="bold" className="relative shrink-0" style={iconColors ? { color: hueVar("rose") } : undefined} />
        {!compact && <span className="relative">{t("Fehler melden")}</span>}
      </button>
    </>
  );

  const header = chrome && (
    // The window is dragged by the header's and the navigation's empty parts.
    <header className="relative flex h-14 shrink-0 items-center gap-2 ps-4 pe-2" onMouseDown={chrome.onDrag}>
      {compact && fieldShown
        ? searchPill("min-w-0 flex-1")
        : showsHeaderTitle(width, !!chrome.center) && <h2 className="truncate text-display font-medium text-label">{t(allPages.find((p) => p.id === page)!.label)}</h2>}
      {chrome.center && !(compact && fieldShown) && <div className="absolute left-1/2 -translate-x-1/2">{chrome.center}</div>}
      <button
        aria-label={t("Schließen")}
        title={t("Schließen")}
        onClick={chrome.onClose}
        className="pressable ms-auto flex size-10 shrink-0 items-center justify-center rounded-full text-label-2"
      >
        <X size={18} weight="bold" />
      </button>
    </header>
  );

  const pageArea = (
    // Ref on the stable container: popLayout doesn't pass refs to the child. A container only under Material: it also contains
    // layout and style, a new stacking context and a containing block for fixed elements, which Crest must not get.
    <div ref={scroller} className="relative min-w-0 flex-1 roomy:ms-2 roomy:me-4 roomy:@container">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={viewKey}
          className="absolute inset-0 flex flex-col gap-4 overflow-y-auto pb-6 [scrollbar-width:none] roomy:gap-3"
          // The rows' icon circles take the page's hue from here (Row in controls.tsx).
          data-row-hues={iconColors || undefined}
          style={{ maskImage: "linear-gradient(180deg, #000 calc(100% - 28px), transparent)", "--row-hue": hueVar(allPages.find((p) => p.id === page)!.hue) } as MotionStyle}
          {...(view.cascade
            ? { initial: "hidden", animate: "shown", variants: PAGE_CASCADE }
            : { initial: { opacity: 0 }, animate: { opacity: 1, transition: content.enter } })}
          exit={{ opacity: 0, transition: content.exit }}
        >
          {searching ? <SearchResults hits={results} onOpen={openHit} /> : <PageContent page={page} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );

  const hiddenIndex = searching && (
    // Every page, never shown: only read for the index. The LayoutGroup keeps their layoutIds apart from the visible ones.
    <div ref={hidden} hidden inert>
      <LayoutGroup id="settings-search">
        {pages.map((p) => (
          <div key={p.id} data-page={p.id}>
            <PageContent page={p.id} />
          </div>
        ))}
      </LayoutGroup>
    </div>
  );

  if (material)
    return (
      <RoomyContext value={true}>
        <div ref={root} data-roomy className={`relative flex h-full ${layout === "top" ? "flex-col" : ""}`}>
          {layout === "list" && (
            // A still light of the theme's colour behind the navigation.
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 start-0 w-[176px]"
              style={{ background: "radial-gradient(closest-side, var(--color-primary), transparent)", opacity: 0.1 }}
            />
          )}
          {layout === "top" ? (
            <>
              {header}
              <nav className="flex h-14 shrink-0 items-center gap-0.5 overflow-x-auto px-2 [scrollbar-width:none]">{materialNav}</nav>
            </>
          ) : (
            // Scrolls when the items do not fit, keeping 4 px around a focused one for its ring.
            <nav
              className={`relative flex shrink-0 flex-col overflow-y-auto p-2 scroll-py-1 [scrollbar-width:none] ${layout === "rail" ? "w-14 items-center gap-0.5" : "w-[176px]"}`}
              onMouseDown={chrome?.onDrag}
            >
              {materialNav}
            </nav>
          )}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {layout !== "top" && header}
            {/* The panel has no header: the opened field takes a row of its own above the content. */}
            {!chrome && compact && fieldShown && <div className="flex shrink-0 px-2 pb-2">{searchPill("min-w-0 flex-1")}</div>}
            {pageArea}
          </div>
          {hiddenIndex}
        </div>
      </RoomyContext>
    );

  return (
    // Roomy in both styles: the roomy: variant and the context only change anything under Material.
    <RoomyContext value={true}>
      <div ref={root} data-roomy className="flex h-full gap-3 px-4 pt-1 pb-3">
        {/* Scrolls when the pages are taller than the room (the notch's settings tab, the window at its smallest), keeping 4 px around a focused item for its ring; shrink-0 keeps a wrapped name on its two lines. */}
        <nav className="-mx-1 flex w-[144px] shrink-0 flex-col gap-0.5 overflow-y-auto px-1 pb-1 scroll-py-1 [scrollbar-width:none]">
          <label className="mb-1 flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] bg-fill-1 px-2 text-label-3 focus-within:bg-fill-2">
            <MagnifyingGlass size={12} weight="bold" className="shrink-0" />
            {input}
          </label>
          {scopePages.map((p) => {
            const active = p.id === page && !searching;
            return (
              <button
                key={p.id}
                onClick={() => show(p.id)}
                aria-current={active ? "page" : undefined}
                className={`pressable relative flex min-h-8 shrink-0 items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-start text-body transition-colors duration-150 ${
                  active ? "text-label" : "text-label-3 hover:text-label-2"
                }`}
              >
                {active && <motion.span layoutId="settings-page" className="absolute inset-0 rounded-[8px] bg-fill-2" transition={springs.snappy} />}
                <p.icon size={15} weight={active ? "fill" : "bold"} className="relative shrink-0" style={iconColors ? { color: hueVar(p.hue) } : undefined} />
                {/* Wraps like the bug report below: "Apps und Fenster" is longer than the column in most languages. */}
                <span className="relative leading-tight">{t(p.label)}</span>
              </button>
            );
          })}
          {/* Not a page: opens GitHub's form, with this version filled in. */}
          <button
            onClick={openBugReport}
            title={t("Öffnet das Formular auf GitHub, mit deiner Crest-Version schon eingetragen")}
            className="pressable relative flex min-h-8 shrink-0 items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-start text-body text-label-3 transition-colors duration-150 hover:text-label-2"
          >
            <Bug size={15} weight="bold" className="relative shrink-0" style={iconColors ? { color: hueVar("rose") } : undefined} />
            {/* Longer in some languages than the pages' names: it wraps rather than being cut. */}
            <span className="relative leading-tight">{t("Fehler melden")}</span>
          </button>
        </nav>
        {pageArea}
        {hiddenIndex}
      </div>
    </RoomyContext>
  );
}

function SearchResults({ hits, onOpen }: { hits: Hit[]; onOpen: (h: Hit) => void }) {
  if (!hits.length) return <div className="px-3 pt-2 text-caption text-label-3">{t("Nichts gefunden")}</div>;
  return (
    <div className="flex flex-col divide-y divide-separator overflow-hidden rounded-[12px] bg-fill-1 material:divide-y-0 material:rounded-[24px] material:p-2">
      {hits.map((h) => {
        const pageName = t(allPages.find((p) => p.id === h.page)!.label);
        // The Taskbar's General and the Notch's would read alike.
        const scopeName = scopeOf(h.page) === "taskbar" ? t("Taskleiste") : "";
        return (
          <button
            key={`${h.page}|${h.groupId}|${h.label}`}
            onClick={() => onOpen(h)}
            className="flex min-h-9 flex-col items-stretch px-3 py-1.5 text-start outline-none hover:bg-fill-2 focus-visible:bg-fill-2 material:min-h-12 material:rounded-[16px]"
          >
            <span className="flex items-baseline justify-between gap-3">
              <span className="truncate text-body text-label">{h.label}</span>
              <span className="shrink-0 text-caption text-label-4 material:text-label-2">{[...new Set([scopeName, pageName, h.group])].filter(Boolean).join(" · ")}</span>
            </span>
            {h.hint && <span className="text-caption text-label-3">{h.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** One settings page's groups; also rendered hidden for the search index. */
function PageContent({ page }: { page: PageId }) {
  return (
    <>
      {page === "general" && (
        <>
          <General />
          <Weather />
          <Updates />
          <BackupSettings />
          <Support />
        </>
      )}
      {page === "display" && (
        <>
          <Display />
          <MusicSettings />
          <Presentation />
        </>
      )}
      {page === "window" && <WindowSettings />}
      {page === "tools" && (
        <>
          <Tools />
          {!isMac && <SystemSettings />}
          {findTab("vault") && <VaultSettings />}
          <ProductivitySettings />
          {findTab("terminal") && <TerminalSettings />}
          {findTab("launcher") && <LauncherSettings />}
          <ClipboardSettings />
        </>
      )}
      {page === "timer" && (
        <>
          <Alarm />
          <FocusSoundSettings />
          <TimerLookSettings />
          <ClockLookSettings />
          <BreaksSettings />
        </>
      )}
      {page === "notices" && <NoticesSettings />}
      {page === "plugins" && <PluginSettings />}
      {page === "ai" && (
        <>
          <Ask />
          <UsageSettings />
          <KeysNote />
        </>
      )}
      {page === "accounts" && (
        <>
          {findTab("discord") && <Discord />}
          <TradingSettings />
          <GithubSettings />
          <LeetcodeSettings />
          <CalendarSettings />
          <KeysNote />
        </>
      )}
      {page === "themes" && <ThemeSettings />}
      {page === "taskbar" && <TaskbarGeneral />}
      {page === "taskbar-items" && <TaskbarItems />}
      {page === "taskbar-widgets" && <WidgetsPage />}
      {page === "taskbar-apps" && <TaskbarApps />}
      {page === "taskbar-look" && <TaskbarLook />}
    </>
  );
}

/** Version, update check and install on click. Nothing downloads unasked. */
function Updates() {
  const auto = settings.use().updates.auto;
  const u = update.use();
  const unseen = useUnseen();
  // Remember what was new when the section opened, so the labels stay while reading.
  const [fresh] = useState(() => new Set(unseen.map((e) => e.version)));
  const [showLog, setShowLog] = useState(false);
  const busy = u.phase === "checking" || u.phase === "downloading";
  const status = {
    idle: undefined,
    checking: t("Suche …"),
    current: t("Du hast die neueste Version"),
    available: u.installFailed ? t("Download fehlgeschlagen, später noch einmal versuchen") : t("Neue Version gefunden"),
    downloading: t("Wird geladen … {n} %", { n: Math.round(u.progress * 100) }),
    error: t("Prüfung fehlgeschlagen, später erneut versuchen"),
  }[u.phase];
  const upcoming = u.notes && u.version && u.current ? between(u.notes, u.current, u.version) : [];

  return (
    <Group title={t("Updates")} id="settings-updates">
      <Row icon="info" label={t("Version {v}", { v: u.current ?? "–" })} hint={status}>
        {!u.store && (
          <Button disabled={busy} onClick={() => void checkForUpdate()}>
            {t("Jetzt suchen")}
          </Button>
        )}
      </Row>
      {u.store && <Row icon="storefront" label={t("Updates kommen über den Microsoft Store")} />}
      <DiagnosticsRow />
      <PortableNote />
      <AnimatePresence initial={false}>
        {(u.phase === "available" || u.phase === "downloading") && u.version && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={fade} className="overflow-hidden">
            <Row icon="download" label={t("Version {v} verfügbar", { v: u.version })} hint={t("Lädt, installiert und startet neu")}>
              {u.phase === "downloading" ? (
                <div className="h-1.5 w-28 overflow-hidden rounded-full bg-fill-2">
                  <div className="h-full origin-left rtl:origin-right rounded-full bg-primary transition-transform duration-150 ease-linear" style={{ transform: `scaleX(${u.progress})` }} />
                </div>
              ) : (
                <Button primary onClick={() => void installUpdate()}>
                  {t("Jetzt aktualisieren")}
                </Button>
              )}
            </Row>
            {upcoming.length > 0 && <ChangelogList entries={upcoming} />}
          </motion.div>
        )}
      </AnimatePresence>
      <Row icon="campaign"
        label={
          <span className="flex items-center gap-1.5">
            {t("Neuerungen")}
            {unseen.length > 0 && !showLog && <span className="size-[7px] rounded-full bg-link" />}
          </span>
        }
        hint={unseen.length > 0 ? t(unseen.length === 1 ? "Neu in Version {v}" : "{n} Versionen seit deinem letzten Update", { v: unseen[0].version, n: unseen.length }) : undefined}
      >
        <Button
          onClick={() => {
            if (!showLog) markSeen();
            setShowLog((v) => !v);
          }}
        >
          {showLog ? t("Ausblenden") : t("Anzeigen")}
        </Button>
      </Row>
      <AnimatePresence initial={false}>
        {showLog && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={fade} className="overflow-hidden">
            <ChangelogList entries={between(changelog, null, u.current ?? changelog[0].version)} fresh={fresh} />
          </motion.div>
        )}
      </AnimatePresence>
      {!u.store && (
        <Row icon="update" label={t("Automatisch suchen")} hint={t("Alle 4 Stunden, anonym bei GitHub, ohne deine Daten")}>
          <Switch label={t("Automatisch suchen")} checked={auto} onChange={(on) => updateSettings({ updates: { auto: on } })} />
        </Row>
      )}
    </Group>
  );
}

/** Copies a plain-text block for bug reports (diagnostics.ts): versions, Windows, monitors, settings and error codes only. */
function DiagnosticsRow() {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const copy = async () => {
    const s = settings.get();
    const u = update.get();
    try {
      const [sys, info, port] = await Promise.all([systemDiagnostics(), build.info(), portable.info()]);
      const text = diagnosticsText({
        version: u.current ?? "unknown",
        build: info.store ? "store" : port.portable ? "portable" : "installer",
        os: sys.os,
        osBuild: sys.build,
        arch: sys.arch,
        machine: sys.machine,
        scales: sys.scales,
        panelScale: s.behavior.scale,
        tools: s.tools.filter((x) => x.enabled).map((x) => x.id),
        closedStyle: s.display.idleStyle,
        edge: s.dock.edge,
        anchor: s.dock.anchor,
        errors: [
          ["update", u.phase === "error" ? "check-failed" : null],
          ["github", github.get().error],
          ["leetcode", leetcode.get().error],
          ["fps", fps.get().error],
          ["discord", discordState.get().error],
        ],
      });
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    window.setTimeout(() => setCopied(null), 1600);
  };
  const hint =
    copied === "ok"
      ? t("Kopiert")
      : copied === "failed"
        ? t("Kopieren fehlgeschlagen")
        : t("Version, Windows, Bildschirme und Einstellungen für einen Fehlerbericht, ohne persönliche Daten");
  return (
    <Row icon="troubleshoot" label={t("Diagnose kopieren")} hint={hint}>
      <Button onClick={() => void copy()}>{t("Kopieren")}</Button>
    </Row>
  );
}

function Support() {
  const { store } = update.use();
  return (
    <Group title={t("Unterstützen")} id="settings-support">
      <Row icon="favorite" label={t("Crest unterstützen")} hint={t("Kostenlos und ohne Werbung. Spenden über GitHub Sponsors sind freiwillig")}>
        <Button onClick={openSponsors}>{t("Sponsern")}</Button>
      </Row>
      {store && (
        <Row icon="star" label={t("Crest bewerten")} hint={t("Eine Bewertung im Microsoft Store hilft anderen, Crest zu finden")}>
          <Button onClick={openStoreReview}>{t("Bewerten")}</Button>
        </Row>
      )}
    </Group>
  );
}

/** Versions with their short notes; `fresh` marks the ones new since your last update. */
function KeysNote() {
  return (
    <div className="flex items-start gap-1.5 px-3 pb-1 text-caption text-label-4">
      <LockSimple size={11} weight="bold" className="mt-0.5 shrink-0" />
      {isMac ? t("Schlüssel liegen im Schlüsselbund von macOS. Alles bleibt auf diesem Mac.") : t("Schlüssel liegen in der Windows-Anmeldeinformationsverwaltung. Alles bleibt auf diesem PC.")}
    </div>
  );
}

function Ask() {
  const s = settings.use();
  return (
    <Group title={t("AI-Chat")} id="settings-ask">
      <Row icon="cloud" label={t("Anbieter")}>
        <Segmented<AskProvider>
          id="ask-provider"
          size="sm"
          value={s.ask.provider}
          onChange={(provider) => updateSettings({ ask: { ...s.ask, provider } })}
          options={(Object.keys(providerInfo) as AskProvider[]).map((p) => ({ value: p, label: t(providerInfo[p].label) }))}
        />
      </Row>
      {s.ask.provider === "custom" && (
        <Row icon="link" label={t("Base-URL")} hint={t("OpenAI-kompatibel, endet meist auf /v1")}>
          <TextField
            value={s.ask.configs.custom.baseUrl}
            onChange={(baseUrl) => updateAsk("custom", { baseUrl: baseUrl.trim() })}
            placeholder="https://…/v1"
            width="w-52"
          />
        </Row>
      )}
      <SecretRow
        name={`ai.${s.ask.provider}` as SecretName}
        icon="key"
        label={t("API-Schlüssel")}
        hint={s.ask.provider === "custom" ? t("Für einen Server auf diesem Computer wie LM Studio oder Ollama nicht nötig") : undefined}
      />
      <Row icon="smart_toy" label={t("Modell")} hint={s.ask.provider === "openrouter" ? t("Modell-ID von openrouter.ai/models") : undefined}>
        <TextField
          value={s.ask.configs[s.ask.provider].model}
          onChange={(model) => updateAsk(s.ask.provider, { model: model.trim() })}
          placeholder={t(providerInfo[s.ask.provider].modelHint)}
          width="w-52"
        />
      </Row>
      <Row icon="psychology" label={t("Denkaufwand")} hint={t("Wie gründlich das Modell nachdenkt")}>
        <Segmented
          id="ask-effort-settings"
          size="sm"
          value={s.ask.configs[s.ask.provider].effort}
          onChange={(effort) => updateAsk(s.ask.provider, { effort })}
          options={effortLevels.map((e) => ({ ...e, label: t(e.label) }))}
        />
      </Row>
    </Group>
  );
}

/** Open on hover or click, and the hover delay (also in the first-run setup). */
export function OpenRows() {
  const s = settings.use();
  return (
    <>
      <Row icon="touch_app" label={t("Öffnen")}>
        <Segmented
          id="open-mode"
          size="sm"
          value={s.openMode}
          onChange={(openMode) => updateSettings({ openMode })}
          options={[
            { value: "hover", label: t("Hover") },
            { value: "click", label: t("Klick") },
          ]}
        />
      </Row>
      <AnimatePresence initial={false}>
        {s.openMode === "hover" && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={fade} className="overflow-hidden">
            <Row icon="hourglass_top" label={t("Hover-Verzögerung")}>
              <Segmented
                id="hover-delay"
                size="sm"
                value={s.hoverDelay}
                onChange={(hoverDelay) => updateSettings({ hoverDelay })}
                options={[
                  { value: "fast", label: t("Schnell") },
                  { value: "normal", label: t("Normal") },
                  { value: "patient", label: t("Geduldig") },
                ]}
              />
            </Row>
            <Row icon="arrow_selector_tool" label={t("Darüberfahren öffnet das Tool des Teils")} hint={t("Aus öffnet sich die Notch wie sonst; ein Klick auf einen Teil öffnet sein Tool immer")}>
              <Switch
                label={t("Darüberfahren öffnet das Tool des Teils")}
                checked={s.behavior.hoverParts}
                onChange={(hoverParts) => updateSettings((cur) => ({ behavior: { ...cur.behavior, hoverParts } }))}
              />
            </Row>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** The open shortcut as keycaps, with a warning when another program holds it. */
export function ShortcutRow({ icon }: { icon?: RowSymbol }) {
  const keys = settings.use().behavior.hotkeys.open;
  const openKey = hotkeyStatus.use().open;
  return (
    <Row
      icon={icon}
      label={t("Tastenkürzel")}
      hint={
        !keys ? (
          t("Nicht gesetzt; festlegen unter Fenster")
        ) : openKey === "in-use" ? (
          <span className="text-orange">{t("Ein anderes Programm nutzt diese Kombination, sie ist nicht aktiv; ändern unter Fenster")}</span>
        ) : (
          t("Öffnet und schließt die Notch von überall; ändern unter Fenster")
        )
      }
    >
      {/* Key combinations read left to right in any language. */}
      <span dir="ltr" className="flex items-center gap-1 text-caption text-label-2">
        <Keyboard size={13} weight="bold" className="text-label-3" />
        {keys ? (
          keycaps(keys).map(keyText).map((k) => (
            <kbd key={k} className="rounded-[5px] bg-fill-2 px-1.5 py-0.5 font-sans text-caption material:rounded-[8px] material:bg-fill-3 material:border-b-2 material:border-separator material:font-semibold">{k}</kbd>
          ))
        ) : (
          t("Nicht gesetzt")
        )}
      </span>
    </Row>
  );
}

function General() {
  const s = settings.use();
  const [auto, setAuto] = useState<boolean | null>(null);
  const autostartLabel = isMac ? t("Bei der Anmeldung öffnen") : t("Mit Windows starten");
  const [autoError, setAutoError] = useState<string | null>(null);
  useEffect(() => {
    void autostart.get().then(setAuto);
  }, []);

  return (
    <Group>
      <Row icon="language" label={t("Sprache")}>
        <Select<LanguageSetting>
          width="w-40"
          value={s.lang}
          onChange={(lang) => updateSettings({ lang })}
          options={[{ value: "system", label: t("Systemsprache") }, ...LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_NAMES[l] }))]}
        />
      </Row>
      <Row icon="schedule" label={t("Uhrzeit")}>
        <Segmented
          id="clock-format"
          size="sm"
          value={s.units.clock}
          onChange={(clock) => updateSettings((p) => ({ units: { ...p.units, clock } }))}
          options={[
            { value: "24", label: t("24 Std.") },
            { value: "12", label: t("12 Std.") },
          ]}
        />
      </Row>
      <OpenRows />
      <Row icon="hourglass_bottom" label={t("Schließen-Verzögerung")} hint={t("Wie lange die Notch offen bleibt, nachdem der Zeiger sie verlassen hat")}>
        <Segmented
          id="close-delay"
          size="sm"
          value={s.behavior.closeDelay}
          onChange={(closeDelay) => updateSettings((cur) => ({ behavior: { ...cur.behavior, closeDelay } }))}
          options={[
            { value: "fast", label: t("Schnell") },
            { value: "normal", label: t("Normal") },
            { value: "patient", label: t("Geduldig") },
          ]}
        />
      </Row>
      <Row icon="power_settings_new" label={autostartLabel} hint={autoError ?? undefined}>
        {auto !== null && (
          <Switch
            label={autostartLabel}
            checked={auto}
            onChange={(v) => {
              setAuto(v);
              setAutoError(null);
              // Windows can refuse (the Store build's startup task switched off in Task Manager): say so and show the real state.
              autostart.set(v).catch((e) => {
                setAutoError(tBackend(String(e)));
                void autostart.get().then(setAuto);
              });
            }}
          />
        )}
      </Row>
      <ShortcutRow icon="keyboard" />
      <Row icon="tune" label={t("Einrichtung")} hint={t("Voreinstellung, Aussehen und Öffnen noch einmal wählen")}>
        <Button onClick={() => navigate(setupTab.id)}>{t("Erneut starten")}</Button>
      </Row>
    </Group>
  );
}

const statusAlerts: [keyof ClosedSettings["statusAlerts"], string, string, RowSymbol][] = [
  ["power", "Ladegerät und Akku", "Beim Ein- und Ausstecken, Akku bei 20 und 10 % und wenn er am Ladegerät fertig geladen ist", "battery_charging_full"],
  ["saver", "Energiesparen und Energiemodus", "Wenn das Energiesparen an- oder ausgeht oder du den Energiemodus wechselst", "energy_savings_leaf"],
  ["net", "Netzwerk", "Wenn das Internet wegfällt und zurückkommt", "wifi"],
  ["airplane", "Flugzeugmodus", "Wenn der Flugzeugmodus an- oder ausgeht", "flight"],
  ["bt", "Bluetooth-Geräte", "Beim Verbinden oder Trennen, mit Akku, wenn das Gerät ihn meldet", "bluetooth"],
  ["output", "Ausgabegerät", "Wenn Windows den Ton auf andere Lautsprecher oder Kopfhörer legt; ein Wechsel in Crest zählt nicht", "speaker"],
  ["display", "Bildschirme", "Wenn ein Bildschirm angeschlossen oder getrennt wird, mit seiner Bildwiederholrate", "desktop_windows"],
  ["volume", "Lautstärke", "Mit Pegel, wenn sich die Lautstärke oder Stummschaltung ändert", "volume_up"],
  ["brightness", "Helligkeit", "Eingebauter Bildschirm sofort, externe Monitore über DDC/CI alle 2 Sekunden", "brightness_5"],
  ["lock", "Feststell- und Num-Taste", "Wenn die Feststelltaste oder die Num-Taste umgeschaltet wird", "keyboard_capslock"],
  ["insert", "Einfg-Taste", "Wenn sie allein gedrückt wird; Tastenkürzel wie Umschalt+Einfg zählen nicht", "keyboard_alt"],
  ["mic", "Mikrofon", "Wenn das Mikrofon stumm- oder wieder eingeschaltet wird: mit dem Tastenkürzel, einer Taste am Laptop oder in Windows", "mic"],
  ["focus", "Nicht stören", "Wenn Nicht stören oder eine Fokussitzung an- oder ausgeht", "do_not_disturb_on"],
  ["clip", "Kopieren", "Wenn du Text, einen Link, ein Bild oder Dateien kopierst; braucht das Werkzeug Zwischenablage", "content_copy"],
  ["hideOsd", "Windows-Anzeige ausblenden", "Blendet die Lautstärke- und Helligkeitsanzeige von Windows aus, solange Crest läuft; braucht Lautstärke und Helligkeit", "layers_clear"],
  ["everywhere", "Überall anzeigen", "Lautstärke, Helligkeit, die Sperrtasten, das Mikrofon und das Kopieren auch über Vollbild-Apps und wenn Crest ausgeblendet ist; mit Windows-Anzeige ausblenden erscheint die von Windows nie", "all_inclusive"],
];

/** Where and when the notch shows up. */
function Display() {
  const s = settings.use();
  const d = s.display;
  const fpsError = fps.use().error;
  // The unlock row shows once the counter has answered "no-admin", so ask while gaming mode is on, not only when a game is up.
  useFpsPolling(!isMac && s.gaming.mode !== "off");
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  useEffect(() => {
    void display.monitors().then(setMonitors);
  }, []);
  const label = (m: MonitorInfo, i: number) => `${m.primary ? t("Hauptbildschirm") : t("Bildschirm {n}", { n: i + 1 })} · ${m.width}×${m.height}`;

  return (
    <Group id="settings-display">
      {/* Also with one monitor while "follow" or "all" is saved (a laptop undocked), or it could not be changed back. */}
      {(monitors.length > 1 || d.monitorMode !== "chosen") && (
        <Row icon="desktop_windows"
          label={t("Monitor")}
          hint={d.monitorMode === "follow" ? t("Geschlossen wandert die Notch auf den Bildschirm mit dem Mauszeiger") : d.monitorMode === "all" ? t("Eine geschlossene Notch auf jedem Bildschirm; sie öffnet sich dort, wo du sie berührst") : undefined}
        >
          <Select
            width="w-56"
            value={d.monitorMode !== "chosen" ? d.monitorMode : (d.monitor ?? monitors.find((m) => m.primary)?.name ?? monitors[0].name)}
            onChange={(value) =>
              updateSettings((cur) => ({
                display:
                  value === "follow" || value === "all"
                    ? { ...cur.display, monitorMode: value }
                    : { ...cur.display, monitorMode: "chosen", monitor: monitors.find((m) => m.name === value)?.primary ? null : value },
              }))
            }
            options={[
              ...(isMac ? [] : [{ value: "follow", label: t("Dem Mauszeiger folgen") }, { value: "all", label: t("Alle Monitore") }]),
              ...monitors.map((m, i) => ({ value: m.name, label: label(m, i) })),
            ]}
          />
        </Row>
      )}
      <EdgeSettings />
      {(d.offset !== 0 || d.y !== 5) && (
        <Row icon="open_with" label={t("Position")} hint={t("Notch an der Kopfzeile oder geschlossen ziehen, um sie zu verschieben")}>
          <Button onClick={() => updateSettings((cur) => ({ display: { ...cur.display, offset: 0, y: 5 } }))}>
            <span className="flex items-center gap-1.5">
              <ArrowsInLineHorizontal size={13} weight="bold" /> {t("Zur Mitte")}
            </span>
          </Button>
        </Row>
      )}
      <ClosedStyle />
      <SizeSettings />
      <ClosedParts />
      {d.idleStyle !== "line" && <PetSettingsRows />}
      <Row icon="linear_scale" label={t("Fortschritt auf der Linie")} hint={t("Zeigt, wie weit das Lied ist, solange Musik läuft")}>
        <Switch label={t("Fortschritt auf der Linie")} checked={s.closed.lineProgress} onChange={(lineProgress) => updateSettings((cur) => ({ closed: { ...cur.closed, lineProgress } }))} />
      </Row>
      <Row icon="data_usage" label={t("Hinweis bei Kontingent 70 und 90 %")} hint={t("Braucht den Teil AI-Nutzung")}>
        <Switch label={t("Hinweis bei Kontingent 70 und 90 %")} checked={s.closed.quotaAlerts} onChange={(quotaAlerts) => updateSettings((cur) => ({ closed: { ...cur.closed, quotaAlerts } }))} />
      </Row>
      {/* The download watcher and the status events (power, network, Bluetooth, volume, brightness, lock keys) have no Mac backend. */}
      {!isMac && (
        <>
          <Row icon="download_done" label={t("Hinweis bei fertigem Download")} hint={t("Mit Im Ordner zeigen und Zur Ablage, nicht in den Ruhezeiten")}>
            <Switch label={t("Hinweis bei fertigem Download")} checked={s.closed.downloadAlerts} onChange={(downloadAlerts) => updateSettings((cur) => ({ closed: { ...cur.closed, downloadAlerts } }))} />
          </Row>
          <Row icon="notification_important" label={t("Statusmeldungen")} />
          {statusAlerts.map(([k, label, hint, icon]) => (
            <Row key={k} icon={icon} label={t(label)} hint={t(hint)}>
              <Switch label={t(label)} checked={s.closed.statusAlerts[k]} onChange={(v) => updateSettings((cur) => ({ closed: { ...cur.closed, statusAlerts: { ...cur.closed.statusAlerts, [k]: v } } }))} />
            </Row>
          ))}
        </>
      )}
      <Row icon="filter_center_focus" label={t("Fokus-Modus mit drei Klicks")} hint={t("Drei schnelle Klicks auf die geschlossene Notch machen sie halb durchsichtig oder zur Linie und lassen Klicks durch. Drei weitere Klicks, das Öffnen per Tastenkürzel oder ein Neustart holen sie zurück.")}>
        <Switch label={t("Fokus-Modus mit drei Klicks")} checked={d.focusClicks} onChange={(focusClicks) => updateSettings((cur) => ({ display: { ...cur.display, focusClicks } }))} />
      </Row>
      {d.focusClicks && (
        <Row icon="opacity"
          label={t("Fokus-Darstellung")}
          hint={d.focusStyle === "line" ? t("Nur eine dünne Linie am Rand, ohne Musik und Co.") : t("Halb durchsichtig")}
        >
          <Segmented
            id="focus-style"
            size="sm"
            value={d.focusStyle}
            onChange={(focusStyle) => updateSettings((cur) => ({ display: { ...cur.display, focusStyle } }))}
            options={[
              { value: "dim", label: t("Durchsichtig") },
              { value: "line", label: t("Linie") },
            ]}
          />
        </Row>
      )}
      {/* Hardware readings and FPS have no Mac backend yet. */}
      {!isMac && (
        <>
          <Row icon="sports_esports"
            label={t("Gaming-Modus")}
            hint={t("FPS und Auslastung in der geschlossenen Notch")}
          >
            <Segmented
              id="gaming-mode"
              size="sm"
              value={s.gaming.mode}
              onChange={(mode) => updateSettings({ gaming: { mode } })}
              options={[
                { value: "off", label: t("Aus") },
                { value: "fullscreen", label: t("Bei Vollbild") },
                { value: "on", label: t("Immer") },
              ]}
            />
          </Row>
          {fpsError === "no-admin" && <FpsUnlockRow />}
          {fpsError === "relogin" && (
            <Row icon="speed" label={t("FPS freischalten")} hint={t("Fertig: einmal ab- und wieder anmelden, dann laufen die FPS")}>
              <SignOut size={18} weight="bold" className="text-orange" />
            </Row>
          )}
        </>
      )}
      {/* macOS shows its own recording dots, and Crest cannot read the state there. */}
      {!isMac && (
        <Row icon="fiber_manual_record" label={t("Aufnahme-Punkte")} hint={t("Grün: Mikrofon/Kamera aktiv · Rot: Bildschirm wird aufgenommen")}>
          <Switch label={t("Aufnahme-Punkte")} checked={s.privacyDots} onChange={(privacyDots) => updateSettings({ privacyDots })} />
        </Row>
      )}
    </Group>
  );
}

/** Closed look: notch, capsule or line, with previews (also in the first-run setup). */
export function ClosedStyle() {
  const style = settings.use().display.idleStyle;
  return (
    <div className="pb-3">
      <Row icon="rounded_corner"
        label={t("Geschlossen")}
        hint={
          style === "line"
            ? t("Nur eine dünne Linie, ein abgelaufener Timer klappt trotzdem auf")
            : style === "capsule"
              ? t("Schwebt frei, zum Verschieben ziehen")
              : t("Die Notch zeigt Musik, Timer und Co.")
        }
      />
      <div className="px-3">
        <StyleCards
          label={t("Geschlossen")}
          value={style}
          onChange={(idleStyle) => updateSettings((cur) => ({ display: { ...cur.display, idleStyle } }))}
          options={[
            { value: "notch", label: t("Notch"), preview: <ShapePreview d="M6 0H54C51 0 50 1.5 50 4V8C50 11 48 13 45 13H15C12 13 10 11 10 8V4C10 1.5 9 0 6 0Z" /> },
            { value: "capsule", label: t("Kapsel"), preview: <ShapePreview d="M16.5 4H43.5A4.5 4.5 0 0 1 43.5 13H16.5A4.5 4.5 0 0 1 16.5 4Z" /> },
            { value: "line", label: t("Linie"), preview: <ShapePreview d="M15 0H45A1 1 0 0 1 45 2H15A1 1 0 0 1 15 0Z" /> },
          ]}
        />
      </div>
    </div>
  );
}

/** Miniature of a closed shape hanging from the screen's top edge (viewBox 60 × 16). */
function ShapePreview({ d }: { d: string }) {
  return (
    <svg width={90} height={24} viewBox="0 0 60 16" aria-hidden>
      <path d={d} fill="currentColor" />
    </svg>
  );
}

/** The nest beside the closed notch: which pet (or none), its size, independent of the notch's, and the side it sits on. */
function PetSettingsRows() {
  const { closed: { pet }, dock } = settings.use();
  const setPet = (patch: Partial<ClosedSettings["pet"]>) => updateSettings((cur) => ({ closed: { ...cur.closed, pet: { ...cur.closed.pet, ...patch } } }));
  return (
    <>
      <Row icon="pets"
        label={t("Haustier")}
        hint={isMac ? t("Neben der Notch: tanzt zur Musik, freut sich über Erledigtes und schläft, wenn nichts los ist") : t("Neben der Notch: tanzt zur Musik, rennt mit der CPU, freut sich über Erledigtes und schläft, wenn nichts los ist")}
      >
        <div className="flex items-center gap-2">
          {pet.id && <PetArt id={pet.id} mood="idle" pace=".5s" size={30} />}
          <Select
            value={pet.id ?? "none"}
            width="w-48"
            options={[{ value: "none", label: t("Aus") }, ...PET_IDS.map((p) => ({ value: p, label: t(PET_NAMES[p]) }))]}
            onChange={(v) => setPet({ id: v === "none" ? null : (v as PetId) })}
          />
        </div>
      </Row>
      {pet.id && (
        <>
          <Row icon="aspect_ratio" label={t("Größe des Haustiers")} hint={t("Unabhängig von der Größe der Notch")}>
            <div className="flex w-52 items-center gap-2">
              <Slider label={t("Größe des Haustiers")} value={pet.size} min={PET_SIZE.min} max={PET_SIZE.max} step={2} onChange={(size) => setPet({ size })} />
              <span className="tabular w-8 text-end text-caption text-label-2">{pet.size}</span>
            </div>
          </Row>
          <Row icon="swap_horiz" label={t("Seite")}>
            <Segmented id="pet-side" size="sm" value={pet.side} options={across(dock.edge) ? [{ value: "left", label: t("Oben") }, { value: "right", label: t("Unten") }] : [{ value: "left", label: t("Linke Seite") }, { value: "right", label: t("Rechte Seite") }]} onChange={(side) => setPet({ side })} />
          </Row>
        </>
      )}
    </>
  );
}

/** Closed-row parts fed by Windows-only code (hardware readings, the Discord tool, the download watcher). */
const NO_MAC_PARTS = new Set<PartId>(["readings", "discord", "downloads"]);

/** Parts of the closed row (notch and capsule share them): drag to reorder, switch on/off. Same pattern as `Tools()`. */
function ClosedParts() {
  const { closed: c, music, tools, notices, github, leetcode: lcSettings, dock } = settings.use();
  const [dragging, setDragging] = useState<PartId | null>(null);
  const setClosed = (patch: (cur: ClosedSettings) => Partial<ClosedSettings>) => updateSettings((cur) => ({ closed: { ...cur.closed, ...patch(cur.closed) } }));
  // Only these always show; battery, power and temperature can be missing, so they cannot keep the part alone. The network
  // counts too, so the part can show only the download and upload speed (issue #11).
  const mainReadings = ["cpu", "ram", "gpu", "net"] as const;
  const shown = c.order.filter((id) => !(isMac && NO_MAC_PARTS.has(id)));
  const readingsOn = mainReadings.filter((k) => c.readings[k]).length;
  const iconColors = useIconColors();
  // What a part shows nothing without; the part itself says so while it is on.
  const needs: Partial<Record<PartId, string | false>> = {
    calendar: !tools.some((x) => x.id === "calendar" && x.enabled) && t("Braucht das Tool Kalender"),
    script: !(notices.enabled && notices.cli) && t("Braucht Live-Mitteilungen und crest-notify"),
    github: !github.user.trim() && t("Braucht deinen GitHub-Namen"),
    leetcode: !lcSettings.user.trim() && t("Braucht deinen LeetCode-Namen"),
  };

  return (
    <div>
      <Row icon="widgets" label={t("Inhalt")} hint={t("Gilt für Notch und Kapsel, zum Sortieren ziehen")} />
      {/* Parts a Mac does not show keep their place at the end of the order. */}
      <Reorder.Group
        as="div"
        axis="y"
        values={shown}
        onReorder={(order: PartId[]) => setClosed((cur) => ({ order: [...order, ...cur.order.filter((id) => !order.includes(id))] }))}
        className="divide-y divide-separator"
      >
        {shown.map((id) => {
          const { label, icon: I, hue } = partInfo[id];
          const on = c.parts[id];
          return (
            <Reorder.Item
              key={id}
              value={id}
              as="div"
              transition={springs.snappy}
              onDragStart={() => setDragging(id)}
              onDragEnd={() => setDragging(null)}
              whileDrag={{ scale: 1.02 }}
              className={`group relative flex h-9 cursor-grab items-center gap-2.5 px-3 active:cursor-grabbing ${
                dragging === id ? "z-10 rounded-[10px] bg-elevated shadow-[0_6px_18px_rgb(0_0_0/0.45)] material:shadow-level4 m3-dragged" : ""
              }`}
            >
              <DotsSixVertical size={13} weight="bold" className="-ms-1 text-label-4 transition-colors group-hover:text-label-3" />
              <I size={15} weight="bold" className={on && iconColors ? "" : on ? "text-label-2" : "text-label-4"} style={on && iconColors ? { color: hueVar(hue) } : undefined} />
              <span className={`flex-1 text-body select-none ${on ? "text-label" : "text-label-3"}`}>
                {t(label)}
                {on && needs[id] && <span className="ms-2 text-caption text-label-3">{needs[id]}</span>}
              </span>
              <div onPointerDown={(e) => e.stopPropagation()} className="flex items-center gap-3">
                {on && id === "readings" &&
                  mainReadings.map((k) => (
                    <SubSwitch
                      key={k}
                      label={k.toUpperCase()}
                      checked={c.readings[k]}
                      // One reading stays on, otherwise the part would be empty.
                      onChange={(v) => (v || readingsOn > 1) && setClosed((cur) => ({ readings: { ...cur.readings, [k]: v } }))}
                    />
                  ))}
                {/* Not on a side edge: the narrow column shows the time alone. */}
                {on && id === "clock" && !across(dock.edge) && <SubSwitch label={t("Datum")} checked={c.clockDate} onChange={(clockDate) => setClosed(() => ({ clockDate }))} />}
                {on && id === "clock" && <SubSwitch label={t("Sekunden")} checked={c.clockSeconds} onChange={(clockSeconds) => setClosed(() => ({ clockSeconds }))} />}
                {on && id === "title" && <SubSwitch label={t("Songtext")} checked={music.titleLyrics} onChange={(titleLyrics) => setMusic({ titleLyrics })} />}
                {on && id === "title" && <SubSwitch label={t("Endlos scrollen")} checked={music.titleLoop} onChange={(titleLoop) => setMusic({ titleLoop })} />}
                <Switch label={t(label)} checked={on} onChange={(v) => setClosed((cur) => ({ parts: { ...cur.parts, [id]: v } }))} />
              </div>
            </Reorder.Item>
          );
        })}
      </Reorder.Group>
    </div>
  );
}

/** Presentation mode: one switch, plus automatic while the screen is recorded or shared. */
function Presentation() {
  const { manual, auto } = settings.use().presentation;
  const presenting = usePresenting();
  const recording = privacy.use().screen;
  return (
    <Group title={t("Präsentationsmodus")} id="settings-presentation">
      <Row icon="present_to_all"
        label={t("Präsentationsmodus")}
        hint={presenting && !manual ? t("Aktiv, Bildschirmaufnahme erkannt") : t("Blendet Zwischenablage, Kontostände, Tresor, Aufnahmen und Ablage aus")}
      >
        <Switch label={t("Präsentationsmodus")} checked={presenting} onChange={togglePresentation} />
      </Row>
      {!isMac && (
        <Row icon="screen_record" label={t("Bei Bildschirmaufnahme")} hint={t("Teams, Discord, OBS … schaltet sich danach wieder ab")}>
          <Switch
            label={t("Bei Bildschirmaufnahme")}
            checked={auto}
            onChange={(on) => updateSettings((cur) => ({ presentation: { ...cur.presentation, auto: on } }))}
          />
        </Row>
      )}
      {auto && recording && !presenting && (
        <Row icon="stop_screen_share" label={t("Für diese Aufnahme aus")} hint={t("Schaltet sich bei der nächsten wieder ein")} />
      )}
      <HideFromSharingRow />
    </Group>
  );
}

const discordStatus: Record<string, string> = {
  off: "Aus, Tool „Discord“ einschalten",
  "no-config": "Client-ID und Secret fehlen",
  "no-client": "Discord läuft nicht",
  connecting: "Verbinde …",
  authorizing: "In Discord bestätigen",
  ready: "Verbunden",
  error: "Fehler",
};

/** Discord call: your own app in the developer portal (the only way Discord grants voice scopes). */
function Discord() {
  const s = settings.use();
  const state = discordState.use();
  const [id, setId] = useState(s.discord.clientId);
  const save = () => updateSettings({ discord: { clientId: id.trim() } });
  return (
    <Group title="Discord" id="settings-discord">
      <Row icon="cable" label={t("Status")} hint={state.error ? tBackend(state.error) : undefined}>
        <span className={`text-caption ${state.status === "ready" ? "text-green" : "text-label-2"}`}>{t(discordStatus[state.status] ?? state.status)}</span>
      </Row>
      <Row icon="badge" label={t("Client-ID")}>
        <div className="flex items-center gap-1.5">
          <TextField value={id} onChange={setId} onSubmit={save} placeholder="123456789012345678" width="w-40" />
          {id.trim() !== s.discord.clientId && <Button onClick={save}>{t("Sichern")}</Button>}
        </div>
      </Row>
      <SecretRow name="discord.secret" icon="key" label={t("Client-Secret")} onSaved={reconnectDiscord} />
      <div className="px-3 py-2 text-caption text-label-3">
        {t("discord.com/developers → New Application → OAuth2: Client-ID und Client-Secret kopieren und unter Redirects http://localhost eintragen und speichern. Beim ersten Verbinden fragt Discord einmal nach.")}
      </div>
    </Group>
  );
}

const durations: { value: string; label: string }[] = [
  { value: "0", label: "1×" },
  { value: "5", label: "{n} s" },
  { value: "15", label: "{n} s" },
  { value: "30", label: "{n} s" },
  { value: "-1", label: "Bis Stopp" },
];

/** Timer alarm: sound, volume, duration, with preview. */
function Alarm() {
  const a = settings.use().alarm;
  const [previewing, setPreviewing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  // Only this preview's own stop: the timer's real alarm shares the global one.
  const stopPreview = useRef<(() => void) | null>(null);
  const set = (patch: Partial<typeof a>) => updateSettings((cur) => ({ alarm: { ...cur.alarm, ...patch } }));

  const preview = (next = a) => {
    window.clearTimeout(timer.current);
    stopPreview.current = playAlarm(next.sound, next.volume, 0);
    setPreviewing(true);
    timer.current = window.setTimeout(() => setPreviewing(false), 2500);
  };
  useEffect(() => () => stopPreview.current?.(), []);

  return (
    <Group id="settings-alarm">
      <Row icon="alarm" label={t("Alarm-Ton")}>
        <div className="flex items-center gap-1.5">
          <button
            aria-label={previewing ? t("Stopp") : t("Probehören")}
            title={previewing ? t("Stopp") : t("Probehören")}
            onClick={() => {
              if (!previewing) return preview();
              stopPreview.current?.();
              setPreviewing(false);
            }}
            className="pressable pressable-fill flex size-7 items-center justify-center rounded-full bg-fill-2 text-label"
          >
            {previewing ? <Stop size={11} weight="fill" /> : <Play size={11} weight="fill" />}
          </button>
          <Select
            width="w-36"
            value={a.sound}
            onChange={(sound) => {
              set({ sound });
              preview({ ...a, sound });
            }}
            options={alarmSounds.map((o) => ({ ...o, label: t(o.label) }))}
          />
        </div>
      </Row>
      <Row icon="volume_up" label={t("Lautstärke")}>
        <div className="flex w-52 items-center gap-2">
          <Slider label={t("Lautstärke")} value={Math.round(a.volume * 100)} min={5} max={100} step={5} onChange={(v) => set({ volume: v / 100 })} />
          <span className="tabular w-8 text-end text-caption text-label-2">{Math.round(a.volume * 100)}</span>
        </div>
      </Row>
      <Row icon="timelapse" label={t("Dauer")} hint={t("Wie lange der Alarm klingelt")}>
        <Segmented id="alarm-duration" size="sm" value={String(a.duration)} onChange={(v) => set({ duration: Number(v) as AlarmDuration })} options={durations.map((o) => ({ ...o, label: t(o.label, { n: o.value }) }))} />
      </Row>
    </Group>
  );
}

/** Timer: background sound while a focus timer runs, and its volume. */
function FocusSoundSettings() {
  const { focusSound, focusVolume } = settings.use().timer;
  const set = (patch: Partial<{ focusSound: FocusSound; focusVolume: number }>) => updateSettings((cur) => ({ timer: { ...cur.timer, ...patch } }));
  return (
    <Group id="settings-focus-sound">
      <Row icon="headphones" label={t("Fokus-Klang")} hint={t("Spielt, solange ein Fokus-Timer läuft")}>
        <Select width="w-44" value={focusSound} onChange={(v) => set({ focusSound: v })} options={focusSounds.map((o) => ({ ...o, label: t(o.label) }))} />
      </Row>
      <Row icon="volume_up" label={t("Lautstärke")}>
        <div className="flex w-52 items-center gap-2">
          <Slider label={t("Lautstärke")} value={Math.round(focusVolume * 100)} min={5} max={100} step={5} onChange={(v) => set({ focusVolume: v / 100 })} />
          <span className="tabular w-8 text-end text-caption text-label-2">{Math.round(focusVolume * 100)}</span>
        </div>
      </Row>
    </Group>
  );
}

/** FPS without admin: unlock once instead of running the notch as administrator every time. */
function FpsUnlockRow() {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "relogin" | "cancelled" | "failed">("idle");
  const hint = {
    idle: t("Einmalige Windows-Abfrage, danach nie wieder Administratorrechte"),
    busy: t("Bitte die Windows-Abfrage bestätigen …"),
    ok: t("Freigeschaltet, die FPS laufen"),
    relogin: t("Fertig: einmal ab- und wieder anmelden, dann laufen die FPS"),
    cancelled: t("Abgebrochen"),
    failed: t("Hat nicht geklappt, Crest einmal als Administrator starten"),
  }[state];
  return (
    <Row icon="speed" label={t("FPS freischalten")} hint={hint}>
      {state === "ok" || state === "relogin" ? (
        <CheckCircle size={18} weight="fill" className="text-green" />
      ) : (
        <Button
          disabled={state === "busy"}
          onClick={() => {
            setState("busy");
            void unlockFps().then(setState);
          }}
        >
          {t("Freischalten")}
        </Button>
      )}
    </Row>
  );
}

/** Weather location: automatic via IP or fixed, right here without opening the weather tool. */
function Weather() {
  const { weather: w, units } = settings.use();
  const [searching, setSearching] = useState(false);
  return (
    <Group title={t("Wetter")} id="settings-weather">
      <Row icon="my_location" label={t("Standort")} hint={w?.auto ? t("Ungefähr, aus deiner IP-Adresse") : undefined}>
        <Segmented<"auto" | "manual">
          id="weather-mode"
          size="sm"
          value={!w || w.auto ? "auto" : "manual"}
          onChange={(m) => {
            if (m === "auto") {
              setSearching(false);
              void detectPlace(true);
            } else setSearching(true);
          }}
          options={[
            { value: "auto", label: t("Automatisch") },
            { value: "manual", label: t("Manuell") },
          ]}
        />
      </Row>
      <Row icon="device_thermostat" label={t("Einheit")}>
        <Segmented
          id="temp-unit"
          size="sm"
          value={units.temp}
          onChange={(temp) => updateSettings((p) => ({ units: { ...p.units, temp } }))}
          options={[
            { value: "c", label: "°C" },
            { value: "f", label: "°F" },
          ]}
        />
      </Row>
      <Row icon="location_on" label={t("Ort")}>
        <Button onClick={() => setSearching((v) => !v)}>{w?.name ?? t("Wird erkannt …")}</Button>
      </Row>
      <AnimatePresence initial={false}>
        {searching && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={fade} className="overflow-hidden">
            <div className="p-2">
              <PlaceSearch compact canCancel onDone={() => setSearching(false)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Group>
  );
}

/** Show/hide tools and drag to reorder. At least one stays on. */
function Tools() {
  const s = settings.use();
  // Plugin tools are listed once their list has been read.
  plugins.use();
  // Only tools this platform lists count: one hidden on a Mac cannot be the one that stays on.
  const enabledCount = s.tools.filter((x) => x.enabled && findTab(x.id)).length;
  const [dragging, setDragging] = useState<string | null>(null);

  return (
    <Group>
      <Reorder.Group
        as="div"
        axis="y"
        values={s.tools.map((x) => x.id)}
        onReorder={(ids: string[]) => updateSettings((cur) => ({ tools: ids.map((id) => cur.tools.find((x) => x.id === id)!) }))}
        className="divide-y divide-separator"
      >
        {s.tools.map((tool) => {
          const tab = findTab(tool.id);
          if (!tab) return null;
          return (
            <Reorder.Item
              key={tool.id}
              value={tool.id}
              as="div"
              transition={springs.snappy}
              onDragStart={() => setDragging(tool.id)}
              onDragEnd={() => setDragging(null)}
              whileDrag={{ scale: 1.02 }}
              className={`group relative flex h-9 cursor-grab items-center gap-2.5 px-3 active:cursor-grabbing ${
                dragging === tool.id ? "z-10 rounded-[10px] bg-elevated shadow-[0_6px_18px_rgb(0_0_0/0.45)] material:shadow-level4 m3-dragged" : ""
              }`}
            >
              <DotsSixVertical size={13} weight="bold" className="-ms-1 text-label-4 transition-colors group-hover:text-label-3" />
              <tab.icon size={15} weight="bold" className={tool.enabled ? "text-label-2" : "text-label-4"} />
              <span className={`flex-1 text-body select-none ${tool.enabled ? "text-label" : "text-label-3"}`}>{t(tab.label)}</span>
              <div onPointerDown={(e) => e.stopPropagation()}>
                <Switch
                  label={t(tab.label)}
                  checked={tool.enabled}
                  onChange={(enabled) => {
                    if (!enabled && enabledCount <= 1) return;
                    updateSettings((cur) => ({ tools: cur.tools.map((x) => (x.id === tool.id ? { ...x, enabled } : x)) }));
                  }}
                />
              </div>
            </Reorder.Item>
          );
        })}
      </Reorder.Group>
    </Group>
  );
}

/**
 * Field for a key. Stored values are never read back, it only shows
 * "saved ✓". Typing a new one overwrites it, saving empty deletes it.
 */
export function SecretRow({ name, label, hint, icon, onSaved }: { name: SecretName; label: string; hint?: string; icon?: RowSymbol; onSaved?: () => void }) {
  const [stored, setStored] = useState(false);
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    setValue("");
    void secrets.has(name).then(setStored);
  }, [name]);

  useEffect(() => {
    if (!confirm) return;
    const id = window.setTimeout(() => setConfirm(false), 3000);
    return () => window.clearTimeout(id);
  }, [confirm]);

  const save = async () => {
    setConfirm(false);
    await secrets.set(name, value);
    setStored(!!value.trim());
    setValue("");
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
    onSaved?.();
  };

  return (
    <Row icon={icon} label={label} hint={hint}>
      <div className="flex items-center gap-1.5">
        <AnimatePresence>
          {(saved || (stored && !value)) && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
              <CheckCircle size={14} weight="fill" className="text-green" />
            </motion.span>
          )}
        </AnimatePresence>
        <TextField secret value={value} onChange={setValue} onSubmit={() => value && void save()} placeholder={stored ? t("Gespeichert") : t("Einfügen")} width="w-40" />
        {(value || stored) && (
          <Button onClick={() => (value || confirm ? void save() : setConfirm(true))} disabled={!value && !stored}>
            {value ? t("Sichern") : confirm ? t("Wirklich löschen?") : t("Löschen")}
          </Button>
        )}
      </div>
    </Row>
  );
}
