import { createStore } from "../lib/store";
import type { AlarmDuration, AlarmSound } from "../lib/sound";
import { CLOSED_DEFAULTS, normalizeClosed, type ClosedSettings } from "../notch/row/parts";
import { normalizeLook, type TimerLook } from "../features/timer/looks";
import { WATER_DEFAULTS, normalizeWater, type WaterConfig } from "../features/water/water";
import { normalizeCards, USAGE_CARDS_DEFAULTS, type UsageCards } from "../features/usage/cards";
import { THEME_DEFAULTS, normalizeThemeSettings, type ThemeSettings } from "../features/themes/themes";
import type { ColorScheme } from "../features/system/levels";
import { normalizeFavorites, type Favorite } from "../features/launcher/apps";
import { NOTICE_DEFAULTS, normalizeNotices, type NoticeSettings } from "../features/notices/rules";
import { WINDOW_DEFAULTS, normalizeWindow, type WindowSettings } from "../features/window/model";
import { DOCK_DEFAULTS, normalizeDock, type Dock } from "../notch/edge";

export type AskProvider = "openrouter" | "openai" | "anthropic" | "custom";
export type AskEffort = "low" | "medium" | "high" | "xhigh";

export interface AskProviderConfig {
  model: string;
  effort: AskEffort;
  /** Only for "custom": OpenAI-compatible base, e.g. https://…/v1 */
  baseUrl: string;
}

export interface Settings {
  /** Open on hover or only on click. */
  openMode: "hover" | "click";
  hoverDelay: "fast" | "normal" | "patient";
  /** Order = order in the tool bar. */
  tools: { id: string; enabled: boolean }[];
  /** Portfolio: Trading 212 account, and the base currency ("" = not chosen yet, see features/trading/base.ts). */
  trading: { env: "live" | "demo"; base: string };
  /** AI usage: which providers are shown (order = display order). */
  usage: { claude: boolean; codex: boolean; gemini: boolean; cursor: boolean; openrouter: boolean; deepseek: boolean; zai: boolean };
  /** AI usage cards: order, names typed by the user, model prices set by hand. */
  aiUsage: UsageCards;
  ask: { provider: AskProvider; configs: Record<AskProvider, AskProviderConfig> };
  /** `auto` = detected via IP (again on every start); a picked location stays. */
  weather: { name: string; lat: number; lon: number; auto?: boolean } | null;
  /**
   * Display: always on top or hidden in fullscreen; monitor name (null = primary);
   * `offset` = horizontal offset from the center in CSS px (set by dragging).
   */
  display: {
    /** Replaced by `behavior.rules`; only read once to seed them for older installs. */
    visibility: "always" | "hide-fullscreen";
    monitor: string | null;
    offset: number;
    /** Focus mode look: half transparent (as before) or shrunk to a thin line at the edge. */
    focusStyle: "dim" | "line";
    /**
     * Closed look outside focus mode: the notch, the floating capsule, or a thin line (no
     * music etc.; only a finished timer opens it into the notch until dismissed). Hover and
     * click work as usual.
     */
    idleStyle: "notch" | "capsule" | "line";
    /** Distance of the capsule from the top edge of the monitor in CSS px (set by dragging). */
    y: number;
  };
  /** What the closed notch row shows: which parts, in which order, and their options. */
  closed: ClosedSettings;
  /** Gaming mode: FPS + load in the closed notch: off, only in fullscreen, or always. */
  gaming: { mode: "off" | "fullscreen" | "on" };
  /** Dots like on iPhone: mic/camera (green) or screen recording (red) in use. */
  privacyDots: boolean;
  /** Discord call in the notch (local RPC, on = Discord tool enabled). The client secret is stored with the secrets. */
  discord: { clientId: string };
  alarm: { sound: AlarmSound; volume: number; duration: AlarmDuration };
  language: "de" | "en";
  /** Temperature and clock format; picked from the Windows region on first start. */
  units: { temp: "c" | "f"; clock: "24" | "12" };
  /**
   * Presentation mode: hides clipboard previews, balances and the vault while sharing
   * the screen. `manual` = switched on by hand, `auto` = on while a recording is detected.
   */
  presentation: { manual: boolean; auto: boolean };
  /** Check for a new version once a day, anonymously (installs only on click). */
  updates: { auto: boolean };
  /** Look of the big countdown in the Timer tool and the detached timer window. */
  timer: { look: TimerLook };
  /** To-do reminders (sound), the water reminder and the quote line in Overview. */
  productivity: { reminderSound: boolean; quotes: boolean; water: WaterConfig };
  /** Terminal tool: shell, font size in px, start folder ("" = home), end the shell when the notch closes. */
  terminal: { shell: "pwsh" | "powershell" | "cmd"; fontSize: number; startDir: string; endOnClose: boolean };
  /**
   * Music: the lyrics panel in Now Playing is open; the Song title part shows the current lyric line; the closed notch
   * shows only cover and line while synced lyrics play; the player shown whatever else plays (media app ID, null = automatic).
   */
  music: { lyricsOpen: boolean; titleLyrics: boolean; notchLyrics: boolean; pinned: string | null };
  /** Panel theme, custom themes and the day and night switch (src/features/themes). */
  themes: ThemeSettings;
  /** Hardware tool: colours of the readings, the GPU shown (adapter name, "" = automatic: the busiest; index among adapters of that name), process ranking. */
  system: { colors: ColorScheme; gpu: string; gpuIndex: number; sort: "cpu" | "mem" };
  /**
   * App launcher: pinned apps, `null` until the first app list arrives, which pins the detected
   * AI apps once. `hotkeys`: the first six on Alt+1 to Alt+6, opt-in (other apps lose those keys).
   */
  launcher: { favorites: Favorite[] | null; hotkeys: boolean };
  /** GitHub activity: the public username. An optional token is stored with the secrets. */
  github: { user: string };
  /** Live notices: Windows notifications and crest-notify in the closed notch, with per-app rules and quiet hours. */
  notices: NoticeSettings;
  /** Window behaviour: full-screen and app rules, shortcuts, panel sizes and scale, close delay, mouse (src/features/window). */
  behavior: WindowSettings;
  /** The screen edge the notch and the line hang from, and whether from the screen's edge or the taskbar's (the capsule floats on the top frame). */
  dock: Dock;
}

/** All tool IDs in default order. Must match `src/notch/tabs.ts`. */
export const TOOL_IDS = [
  "overview",
  "media",
  "timer",
  "todos",
  "notes",
  "clipboard",
  "shelf",
  "ask",
  "convert",
  "trading",
  "usage",
  "weather",
  "system",
  "discord",
  "vault",
  "water",
  "scratchpad",
  "terminal",
  "launcher",
  "github",
  "notices",
] as const;

const DEFAULT_OFF = new Set<string>(["system", "discord", "trading", "vault", "water", "scratchpad", "terminal", "github", "notices"]);

const defaults: Settings = {
  openMode: "hover",
  hoverDelay: "normal",
  tools: TOOL_IDS.map((id) => ({ id, enabled: !DEFAULT_OFF.has(id) })),
  trading: { env: "live", base: "" },
  usage: { claude: true, codex: true, gemini: true, cursor: false, openrouter: false, deepseek: false, zai: false },
  aiUsage: USAGE_CARDS_DEFAULTS,
  ask: {
    provider: "custom",
    configs: {
      openrouter: { model: "", effort: "medium", baseUrl: "" },
      openai: { model: "", effort: "medium", baseUrl: "" },
      anthropic: { model: "claude-opus-5-5", effort: "medium", baseUrl: "" },
      custom: { model: "", effort: "medium", baseUrl: "" },
    },
  },
  weather: null,
  display: { visibility: "always", monitor: null, offset: 0, focusStyle: "dim", idleStyle: "notch", y: 5 },
  closed: CLOSED_DEFAULTS,
  gaming: { mode: "off" },
  privacyDots: false,
  discord: { clientId: "" },
  alarm: { sound: "chime", volume: 0.7, duration: 5 },
  language: "en",
  units: regionUnits(),
  presentation: { manual: false, auto: true },
  updates: { auto: true },
  timer: { look: "clean" },
  productivity: { reminderSound: true, quotes: false, water: WATER_DEFAULTS },
  terminal: { shell: "pwsh", fontSize: 13, startDir: "", endOnClose: false },
  music: { lyricsOpen: false, titleLyrics: false, notchLyrics: false, pinned: null },
  themes: THEME_DEFAULTS,
  system: { colors: "calm", gpu: "", gpuIndex: 0, sort: "cpu" },
  launcher: { favorites: null, hotkeys: false },
  github: { user: "" },
  notices: NOTICE_DEFAULTS,
  behavior: WINDOW_DEFAULTS,
  dock: DOCK_DEFAULTS,
};

/** °F and 12 h where the Windows region uses them (US & co.), otherwise °C and 24 h. */
function regionUnits(): Settings["units"] {
  const loc = navigator.language || "en-US";
  let region = "";
  let cycle: string | undefined;
  try {
    region = new Intl.Locale(loc).maximize().region ?? "";
    cycle = new Intl.DateTimeFormat(loc, { hour: "numeric" }).resolvedOptions().hourCycle;
  } catch {
    // Unknown locale → metric, 24 h.
  }
  return {
    temp: ["US", "LR", "MM", "BS", "BZ", "KY", "PW", "FM", "MH"].includes(region) ? "f" : "c",
    clock: cycle === "h12" || cycle === "h11" ? "12" : "24",
  };
}

export const hoverDelayMs: Record<Settings["hoverDelay"], number> = { fast: 90, normal: 220, patient: 480 };

/** No settings saved yet = fresh install (read before the store writes its defaults). */
export const firstRun = (() => {
  try {
    return localStorage.getItem("notch:settings") === null;
  } catch {
    return false;
  }
})();

export const settings = createStore<Settings>(defaults, { persist: "settings" });

// Fill in settings from older versions: new fields + append new tools.
settings.set((s) => {
  const known = new Set<string>(TOOL_IDS);
  const tools = (s.tools ?? []).filter((t) => known.has(t.id));
  for (const id of TOOL_IDS) {
    if (tools.some((t) => t.id === id)) continue;
    // Overview is the start page, so put it first for existing installs.
    if (id === "overview") tools.unshift({ id, enabled: true });
    else tools.push({ id, enabled: !DEFAULT_OFF.has(id) });
  }
  return {
    ...defaults,
    ...s,
    language: "en", // English only; the field stays for older saved settings
    tools,
    trading: { ...defaults.trading, ...s.trading },
    usage: { ...defaults.usage, ...s.usage },
    aiUsage: normalizeCards(s.aiUsage),
    // A saved y that is not a finite number (null, a string) would place the capsule nowhere.
    display: { ...defaults.display, ...s.display, y: Number.isFinite(s.display?.y) ? s.display.y : defaults.display.y },
    gaming: { ...defaults.gaming, ...s.gaming },
    discord: { ...defaults.discord, ...s.discord },
    alarm: { ...defaults.alarm, ...s.alarm },
    units: { ...defaults.units, ...s.units },
    presentation: { ...defaults.presentation, ...s.presentation },
    updates: { ...defaults.updates, ...s.updates },
    timer: { look: normalizeLook(s.timer?.look) },
    productivity: { ...defaults.productivity, ...s.productivity, water: normalizeWater(s.productivity?.water) },
    terminal: { ...defaults.terminal, ...s.terminal },
    music: { ...defaults.music, ...s.music },
    themes: normalizeThemeSettings(s.themes),
    system: { ...defaults.system, ...s.system },
    // Only an explicit opt-in turns the keys on; an older saved `shortcuts: true` does not.
    launcher: { favorites: normalizeFavorites(s.launcher?.favorites), hotkeys: s.launcher?.hotkeys === true },
    github: { ...defaults.github, ...s.github },
    closed: normalizeClosed(s.closed),
    notices: normalizeNotices(s.notices),
    ask: migrateAsk(s.ask),
    behavior: normalizeWindow(s.behavior, s.display?.visibility),
    dock: normalizeDock(s.dock),
  };
});

/** Migrates the old shape ({ provider: "demo", model }) and adds missing providers. */
function migrateAsk(old: Partial<Settings["ask"]> | undefined): Settings["ask"] {
  const known = Object.keys(defaults.ask.configs) as AskProvider[];
  const provider = old?.provider && known.includes(old.provider) ? old.provider : defaults.ask.provider;
  const configs = { ...defaults.ask.configs };
  for (const p of known) configs[p] = { ...defaults.ask.configs[p], ...old?.configs?.[p] };
  return { provider, configs };
}

export function updateAsk(provider: AskProvider, patch: Partial<AskProviderConfig>) {
  settings.set((s) => ({ ...s, ask: { ...s.ask, configs: { ...s.ask.configs, [provider]: { ...s.ask.configs[provider], ...patch } } } }));
}

export function updateSettings(patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)) {
  settings.set((s) => ({ ...s, ...(typeof patch === "function" ? patch(s) : patch) }));
}
