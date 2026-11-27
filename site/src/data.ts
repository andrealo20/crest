import type { Icon } from "./icons";
import {
  ArrowsLeftRight,
  BellSimple,
  Calculator,
  Camera,
  Cat,
  CalendarBlank,
  CalendarCheck,
  ChartLineUp,
  CheckCircle,
  ClipboardText,
  CloudSun,
  Code,
  Cpu,
  DiscordLogo,
  Drop,
  Eyedropper,
  Files,
  Hourglass,
  ImageSquare,
  LeetcodeLogo,
  Translate,
  Gauge,
  GithubLogo,
  GlobeHemisphereWest,
  MagnifyingGlass,
  MusicNotesSimple,
  NotePencil,
  Robot,
  RocketLaunch,
  Scroll,
  SquaresFour,
  Sparkle,
  TerminalWindow,
  Timer,
  Tray,
  Vault,
  VideoCamera,
  Waveform,
} from "./icons";

/** Colours of the logo, from assets/logo/crest-icon.svg. */
export const LOGO = { yellow: "#ffc75f", orange: "#ff9a4d", red: "#ff6b6b", pink: "#e0559e", purple: "#7b61ff" } as const;

/** HUE_PALETTE (src/features/themes/themes.ts), the bright shade used on dark themes. */
export const HUE = {
  red: "#ff665e",
  orange: "#ff7c2f",
  amber: "#ffb511",
  lime: "#bfe03a",
  green: "#00c26a",
  emerald: "#00b38f",
  teal: "#00a6a6",
  cyan: "#3ec7ff",
  sky: "#4fa8ff",
  blue: "#3d7bff",
  indigo: "#6b6bff",
  violet: "#9d7aff",
  purple: "#c069ff",
  pink: "#ff48b0",
  rose: "#ff5c87",
  yellow: "#ffe800",
  slate: "#9aa3ad",
} as const;
export type HueName = keyof typeof HUE;

export interface Tool {
  id: string;
  label: string;
  icon: Icon;
  hue: HueName;
}

/** Tool ids, labels, icons and hues follow src/notch/tabs.ts. */
export const TOOLS: Record<string, Tool> = {
  overview: { id: "overview", label: "Overview", icon: SquaresFour, hue: "blue" },
  weather: { id: "weather", label: "Weather", icon: CloudSun, hue: "sky" },
  media: { id: "media", label: "Now Playing", icon: MusicNotesSimple, hue: "pink" },
  timer: { id: "timer", label: "Timer", icon: Timer, hue: "orange" },
  todos: { id: "todos", label: "To-dos", icon: CheckCircle, hue: "green" },
  notes: { id: "notes", label: "Notes", icon: NotePencil, hue: "yellow" },
  water: { id: "water", label: "Water", icon: Drop, hue: "cyan" },
  scratchpad: { id: "scratchpad", label: "Scratchpad", icon: Code, hue: "lime" },
  clipboard: { id: "clipboard", label: "Clipboard", icon: ClipboardText, hue: "teal" },
  shelf: { id: "shelf", label: "Shelf", icon: Tray, hue: "amber" },
  convert: { id: "convert", label: "Converter", icon: ArrowsLeftRight, hue: "rose" },
  launcher: { id: "launcher", label: "Launcher", icon: RocketLaunch, hue: "orange" },
  capture: { id: "capture", label: "Capture", icon: Camera, hue: "cyan" },
  recorder: { id: "recorder", label: "Recorder", icon: Waveform, hue: "rose" },
  camera: { id: "camera", label: "Camera", icon: VideoCamera, hue: "pink" },
  find: { id: "find", label: "Find on screen", icon: MagnifyingGlass, hue: "violet" },
  ask: { id: "ask", label: "Ask", icon: Sparkle, hue: "violet" },
  usage: { id: "usage", label: "AI usage", icon: Gauge, hue: "purple" },
  system: { id: "system", label: "Hardware", icon: Cpu, hue: "red" },
  terminal: { id: "terminal", label: "Terminal", icon: TerminalWindow, hue: "slate" },
  github: { id: "github", label: "GitHub", icon: GithubLogo, hue: "violet" },
  calendar: { id: "calendar", label: "Calendar", icon: CalendarBlank, hue: "red" },
  trading: { id: "trading", label: "Portfolio", icon: ChartLineUp, hue: "emerald" },
  vault: { id: "vault", label: "Vault", icon: Vault, hue: "slate" },
  discord: { id: "discord", label: "Discord", icon: DiscordLogo, hue: "indigo" },
  notices: { id: "notices", label: "Notices page", icon: BellSimple, hue: "amber" },
  calc: { id: "calc", label: "Calc", icon: Calculator, hue: "indigo" },
  clocks: { id: "clocks", label: "Clocks", icon: GlobeHemisphereWest, hue: "indigo" },
  colour: { id: "colour", label: "Colour", icon: Eyedropper, hue: "purple" },
  habits: { id: "habits", label: "Habits", icon: CalendarCheck, hue: "teal" },
  teleprompter: { id: "teleprompter", label: "Prompter", icon: Scroll, hue: "amber" },
  agents: { id: "agents", label: "Agents", icon: Robot, hue: "indigo" },
  pet: { id: "pet", label: "Pets", icon: Cat, hue: "lime" },
  leetcode: { id: "leetcode", label: "LeetCode", icon: LeetcodeLogo, hue: "amber" },
  screentime: { id: "screentime", label: "Screen Time", icon: Hourglass, hue: "purple" },
  wallpapers: { id: "wallpapers", label: "Wallpapers", icon: ImageSquare, hue: "sky" },
  translate: { id: "translate", label: "Translate", icon: Translate, hue: "cyan" },
  files: { id: "files", label: "Files", icon: Files, hue: "lime" },
};

/** The order of the real tool bar. */
export const TOOL_BAR = [
  "overview", "media", "ask", "convert", "clipboard", "timer", "weather", "shelf", "todos", "notes", "usage", "system",
  "scratchpad", "water", "terminal", "launcher", "github", "calendar", "trading", "vault", "discord", "notices", "capture", "recorder", "camera",
] as const;

export const NOTIFY_CODE = `# a notice, then the same key again with a progress ring
crest-notify "Build finished" -b "Tests passed"
crest-notify "Deploying" -r deploy -p 40

# run a command, then say how it ended and how long it took
crest-notify run -s Tests -- cargo test`;

export const NOTIFY_PART = `# put your own part in the closed row
crest-notify part build "Compiling" -i build -p 40 -o terminal
crest-notify part build --clear`;

export const NOTIFY_ASK = `# ask a question, get the button you pressed back
crest-notify ask --title "Run command?" --body "cargo test" -s Agent
allow`;

export const PLUGIN_JSON = `{
  "id": "hello-crest",
  "name": "Hello Crest",
  "version": "1.0.0",
  "icon": "rocket",
  "entry": "index.html",
  "size": { "w": 520, "h": 250 },
  "permissions": {
    "network": ["api.github.com"],
    "storage": true,
    "notices": true
  }
}`;

export const FAQ: { tab: string; q: string; a: string }[] = [
  { tab: "Price", q: "Is Crest free?", a: "Yes. No ads, no paid tier, no account. It is open source under the GPL-3.0 licence, and the code of every release, Store builds included, is in the repository." },
  { tab: "Demo", q: "Is the demo the real app?", a: "It is the real interface, built for the web and filled with sample data. Anything that needs your PC (hardware readings, your files, Windows notifications) is simulated here, so the demo shows how it looks and moves, not your own data. It is built from the newest code, so now and then it shows a change before the next release has it." },
  { tab: "Systems", q: "What does it run on?", a: "Windows 11 and Windows 10, on x64 and on ARM, and macOS 12 or later on Apple silicon and Intel as a preview. Shelf, Hardware, Discord, Vault, Terminal, Launcher, Notices, Capture, Recorder and Camera are Windows-only for now and do not show on a Mac." },
  { tab: "Network", q: "What does it send over the network?", a: "Once a day, an anonymous count for the stats page: the version, Windows or Mac and where Crest was installed from, with no ID, which Count this install in Settings, General turns off. Everything else goes straight from your PC to the services you turn on, such as the weather, currency rates, lyrics or your AI provider. The full table is in the privacy policy." },
  { tab: "Taskbar", q: "Does it replace the Windows taskbar?", a: "Only if you turn it on, in Settings, Taskbar. Crest's bar then takes the place of Windows' on every monitor, and turning it off or quitting Crest brings Windows' own back. It is Windows only and not in the Microsoft Store version for now." },
  { tab: "Store", q: "Microsoft Store or GitHub?", a: "The Store build is signed by Microsoft and updated by the Store. The installer and the portable zip on GitHub are not code-signed yet, so SmartScreen may warn on first launch: choose More info, then Run anyway." },
  { tab: "Plugins", q: "Can I add my own tools?", a: "Yes. A plugin is a folder of HTML, CSS and JavaScript with a crest-plugin.json. Crest lists what it asks for before you install it, and it runs sandboxed with only the network addresses and storage it declares." },
];
