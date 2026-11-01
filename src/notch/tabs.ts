import type { ComponentType } from "react";
import {
  ArrowsLeftRight,
  BellSimple,
  CalendarBlank,
  CheckCircle,
  ClipboardText,
  CloudSun,
  Code,
  Cpu,
  Drop,
  Gauge,
  GearSix,
  HandWaving,
  GithubLogo,
  RocketLaunch,
  SquaresFour,
  MusicNotesSimple,
  NotePencil,
  Sparkle,
  Timer,
  Tray,
  Vault,
  TerminalWindow,
  type Icon,
} from "@phosphor-icons/react";
import { DepotIcon } from "../ui/icons";
import { DiscordLogo } from "../ui/brands";
import { OverviewView } from "../features/overview/OverviewView";
import { NowPlayingView } from "../features/now-playing/NowPlayingView";
import { TimerView } from "../features/timer/TimerView";
import { TodosView } from "../features/todos/TodosView";
import { NotesView } from "../features/notes/NotesView";
import { ClipboardView } from "../features/clipboard/ClipboardView";
import { ShelfView } from "../features/shelf/ShelfView";
import { AskView } from "../features/ask/AskView";
import { ConvertView } from "../features/convert/ConvertView";
import { TradingView } from "../features/trading/TradingView";
import { UsageView } from "../features/usage/UsageView";
import { WeatherView } from "../features/weather/WeatherView";
import { SystemView } from "../features/system/SystemView";
import { DiscordView } from "../features/discord/DiscordView";
import { VaultView } from "../features/vault/VaultView";
import { WaterView } from "../features/water/WaterView";
import { ScratchpadView } from "../features/scratchpad/ScratchpadView";
import { QUOTE_LINE_H } from "../features/quotes/QuoteLine";
import { settings } from "../settings/store";
import { NoticesView } from "../features/notices/NoticesView";
import { SettingsView } from "../features/settings/SettingsView";
import { TerminalView } from "../features/terminal/TerminalView";
import { LauncherView } from "../features/launcher/LauncherView";
import { GithubView } from "../features/github/GithubView";
import { CalendarView } from "../features/calendar/CalendarView";
import { CaptureView } from "../features/capture/CaptureView";
import { SetupView } from "../features/setup/SetupView";
import { Camera } from "@phosphor-icons/react";
import { pluginTab } from "../features/plugins/tabs";

/**
 * Registry of all tools in the open notch. New tool = new entry here
 * + ID in `TOOL_IDS` (src/settings/store.ts). Visibility and order
 * are up to the user in the settings.
 *
 * `size` is the open notch size for this tool (incl. header and dock);
 * the shape morphs there on tab switch. Max. 740 × 540 (window size).
 * Tools can grow it at runtime: `requestSize` (src/notch/size.ts).
 */
export interface NotchTab {
  id: string;
  label: string;
  icon: Icon;
  size: { w: number; h: number };
  View: ComponentType;
}

export const tabs: NotchTab[] = [
  {
    id: "overview",
    label: "Übersicht",
    icon: SquaresFour,
    // Taller while the quote line is on; read on every render, so the shape follows the setting.
    get size() {
      return { w: 520, h: 252 + (settings.get().productivity.quotes ? QUOTE_LINE_H : 0) };
    },
    View: OverviewView,
  },
  { id: "media", label: "Wiedergabe", icon: MusicNotesSimple, size: { w: 520, h: 232 }, View: NowPlayingView },
  { id: "timer", label: "Timer", icon: Timer, size: { w: 520, h: 192 }, View: TimerView },
  { id: "todos", label: "To-Dos", icon: CheckCircle, size: { w: 600, h: 276 }, View: TodosView },
  { id: "notes", label: "Notiz", icon: NotePencil, size: { w: 520, h: 260 }, View: NotesView },
  { id: "clipboard", label: "Zwischenablage", icon: ClipboardText, size: { w: 600, h: 236 }, View: ClipboardView },
  { id: "shelf", label: "Ablage", icon: Tray, size: { w: 560, h: 236 }, View: ShelfView },
  { id: "ask", label: "Ask", icon: Sparkle, size: { w: 560, h: 440 }, View: AskView },
  { id: "convert", label: "Converter", icon: ArrowsLeftRight, size: { w: 520, h: 210 }, View: ConvertView },
  { id: "trading", label: "Depot", icon: DepotIcon, size: { w: 560, h: 380 }, View: TradingView },
  { id: "usage", label: "AI-Nutzung", icon: Gauge, size: { w: 600, h: 320 }, View: UsageView },
  { id: "weather", label: "Wetter", icon: CloudSun, size: { w: 520, h: 250 }, View: WeatherView },
  { id: "system", label: "Hardware", icon: Cpu, size: { w: 720, h: 380 }, View: SystemView },
  { id: "discord", label: "Discord", icon: DiscordLogo, size: { w: 520, h: 210 }, View: DiscordView },
  { id: "vault", label: "Tresor", icon: Vault, size: { w: 560, h: 324 }, View: VaultView },
  { id: "water", label: "Wasser", icon: Drop, size: { w: 520, h: 236 }, View: WaterView },
  { id: "scratchpad", label: "Code-Notizblock", icon: Code, size: { w: 600, h: 320 }, View: ScratchpadView },
  { id: "terminal", label: "Terminal", icon: TerminalWindow, size: { w: 720, h: 460 }, View: TerminalView },
  { id: "launcher", label: "Launcher", icon: RocketLaunch, size: { w: 520, h: 210 }, View: LauncherView },
  { id: "github", label: "GitHub", icon: GithubLogo, size: { w: 520, h: 236 }, View: GithubView },
  { id: "calendar", label: "Kalender", icon: CalendarBlank, size: { w: 560, h: 340 }, View: CalendarView },
  { id: "notices", label: "Mitteilungen", icon: BellSimple, size: { w: 560, h: 320 }, View: NoticesView },
  { id: "capture", label: "Erfassen", icon: Camera, size: { w: 620, h: 336 }, View: CaptureView },
];

/** Settings: reached via the gear, not in the tool bar. */
export const settingsTab: NotchTab = { id: "settings", label: "Einstellungen", icon: GearSix, size: { w: 660, h: 460 }, View: SettingsView };

/** First-run setup: opens by itself until finished or skipped, and again from Settings, General. Not in the tool bar either. */
export const setupTab: NotchTab = { id: "setup", label: "Einrichtung", icon: HandWaving, size: { w: 600, h: 400 }, View: SetupView };

/** Pages reached outside the tool bar; they show whether or not a tool is enabled. */
export const pageTabs = [settingsTab, setupTab];

/** A built-in tool, a page, or an installed plugin (`plugin:<id>`). */
export function findTab(id: string): NotchTab | undefined {
  return pageTabs.find((t) => t.id === id) ?? tabs.find((t) => t.id === id) ?? pluginTab(id);
}
