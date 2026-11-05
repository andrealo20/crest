import type { Icon } from "./icons";
import {
  ArrowsLeftRight,
  BellSimple,
  Camera,
  CalendarBlank,
  ChartLineUp,
  CheckCircle,
  ClipboardText,
  CloudSun,
  Code,
  Cpu,
  DiscordLogo,
  Drop,
  Gauge,
  GithubLogo,
  MagnifyingGlass,
  MusicNotesSimple,
  NotePencil,
  RocketLaunch,
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
};

/** The order of the real tool bar. */
export const TOOL_BAR = [
  "overview", "media", "ask", "convert", "clipboard", "timer", "weather", "shelf", "todos", "notes", "usage", "system",
  "scratchpad", "water", "terminal", "launcher", "github", "calendar", "trading", "vault", "discord", "notices", "capture", "recorder", "camera",
] as const;

export const NOTICES: { kind: string; label: string }[] = [
  { kind: "timer", label: "Timer done" },
  { kind: "ask", label: "A question from a script" },
  { kind: "download", label: "Download finished" },
  { kind: "capture", label: "Screenshot saved" },
  { kind: "recording", label: "Recording" },
  { kind: "status-unplug", label: "Charger unplugged" },
  { kind: "status-bt", label: "Bluetooth headphones" },
  { kind: "volume", label: "Volume" },
  { kind: "brightness", label: "Brightness" },
  { kind: "capslock", label: "Caps Lock" },
  { kind: "call", label: "Discord call" },
  { kind: "todo", label: "To-do due" },
  { kind: "water", label: "Water reminder" },
  { kind: "calendar", label: "Event starting" },
  { kind: "quota", label: "AI quota" },
  { kind: "live", label: "App notification" },
  { kind: "song", label: "New song" },
  { kind: "whatsnew", label: "What's new" },
];

export const STYLES = [
  { id: "notch", label: "Notch" },
  { id: "capsule", label: "Capsule" },
  { id: "line", label: "Line" },
];

export const EDGES = [
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
];

/** [id, name, background, accent] of the built-in themes, from src/features/themes/themes.ts. */
export const THEMES: [string, string, string, string][] = [
  ["dark", "Dark", "#000000", "#0a84ff"],
  ["light", "Light", "#fafafc", "#0066cc"],
  ["one-dark-pro", "One Dark Pro", "#21252b", "#61afef"],
  ["github-dark", "GitHub Dark", "#0d1117", "#4493f8"],
  ["github-light", "GitHub Light", "#ffffff", "#0969da"],
  ["dracula", "Dracula", "#21222c", "#bd93f9"],
  ["night-owl", "Night Owl", "#011627", "#82aaff"],
  ["catppuccin-mocha", "Catppuccin Mocha", "#181825", "#cba6f7"],
  ["catppuccin-latte", "Catppuccin Latte", "#e6e9ef", "#8839ef"],
  ["nord", "Nord", "#2e3440", "#88c0d0"],
  ["rose-pine", "Rosé Pine", "#191724", "#ebbcba"],
  ["rose-pine-dawn", "Rosé Pine Dawn", "#faf4ed", "#d2726e"],
  ["gruvbox-dark", "Gruvbox Dark", "#282828", "#fe8019"],
  ["solarized-light", "Solarized Light", "#fdf6e3", "#268bd2"],
  ["everforest", "Everforest", "#2d353b", "#a7c080"],
];

/** The eight pets (PET_IDS in src/notch/row/parts.ts). */
export const PETS: { id: string; label: string }[] = [
  { id: "cat", label: "Black cat" },
  { id: "cocker", label: "Cocker spaniel" },
  { id: "monkey", label: "Monkey" },
  { id: "sloth", label: "Sloth" },
  { id: "samurai", label: "Samurai" },
  { id: "robot", label: "Robot" },
  { id: "flame", label: "Flame" },
  { id: "zombie", label: "Zombie" },
];

export const LANGS: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "zh-CN", label: "简体中文" },
  { code: "es", label: "Español" },
  { code: "hi", label: "हिन्दी" },
  { code: "ar", label: "العربية" },
  { code: "fr", label: "Français" },
  { code: "pt-BR", label: "Português" },
  { code: "ru", label: "Русский" },
  { code: "ja", label: "日本語" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
];

export type Control = "tools" | "styles" | "edges" | "notices" | "themes" | "langs" | "pets" | "pages" | "play";

export interface Chapter {
  id: string;
  hue: HueName;
  title: string;
  text: string;
  /** Written for the features coming in 1.0.0 (on main, not in the 0.4.0 release). */
  next?: string;
  tools?: string[];
  controls?: Control[];
  /** Tool the stage jumps to when the chapter comes into view. */
  start: string | "close";
  note?: string;
  image?: { src: string; alt: string; w: number; h: number };
}

export const CHAPTERS: Chapter[] = [
  {
    id: "overview",
    hue: "blue",
    title: "Overview and weather",
    text:
      "Overview is a small control centre: the time, the weather, the song playing, Windows focus, keep awake, a volume slider and the brightness of the screen the notch is on. Weather adds the current conditions and a 7-day forecast from Open-Meteo, with no key to enter.",
    next: "Coming in 1.0: quick controls in Overview, a fuller weather tab with an hourly strip and the 7 days, and the weather in the closed notch.",
    tools: ["overview", "weather"],
    start: "overview",
  },
  {
    id: "closed",
    hue: "lime",
    title: "The closed notch",
    text:
      "Shut, Crest is a notch, a capsule or a thin line, on any screen edge. The row shows what you pick, centred: the cover, a running timer, the song title or the lyric line, AI quota rings, CPU, RAM and GPU, network, power, battery, temperature, the clock, today's GitHub count and your next event. When the parts do not fit, the row turns like a carousel, and a click on a part opens its tool.",
    controls: ["styles", "edges"],
    start: "close",
    note: "The capsule always stays on the top edge. Click or tap the notch to open it again.",
    image: { src: "img/closed-notch.png", alt: "The closed notch with a running timer, the AI quota ring, CPU, RAM and GPU load, download and upload, power draw, battery, temperature, the clock and today's GitHub contributions", w: 1222, h: 56 },
  },
  {
    id: "notices",
    hue: "amber",
    title: "Notices",
    text:
      "Notices drop over the closed row, one at a time: a finished timer, a question from a script, a saved screenshot, a download, the charger, the battery, the network, Bluetooth headphones, the volume and brightness HUD, Caps Lock, a Discord call, a due to-do, the water reminder, an event about to start, a quota alert, a new song. A running recording outranks the rest. Press one to see it.",
    next: "Coming in 1.0: coloured notice cards.",
    controls: ["notices"],
    tools: ["notices"],
    start: "close",
  },
  {
    id: "music",
    hue: "pink",
    title: "Music and lyrics",
    text:
      "Now Playing controls any player with a Windows media session. It has a live equalizer, a wavy or straight progress bar, shuffle and repeat, a mixer with a volume slider for every app, and synced lyrics that light up word by word when the source times them. Lyrics can be translated, and romanised for Japanese, Chinese and Korean.",
    tools: ["media"],
    controls: ["play"],
    start: "media",
    image: { src: "img/now-playing-styles.png", alt: "Now Playing with a cover, a wavy progress bar and the playback controls", w: 1040, h: 464 },
  },
  {
    id: "focus",
    hue: "orange",
    title: "Timer, to-dos, notes, water and code",
    text:
      "A focus timer with break presets, six alarm sounds, optional rain or noise in the background and a countdown in the closed notch. To-dos with projects and due times that ring. A note saved as you type. A water log against a daily goal. A scratchpad with syntax colouring and one draft per language. All of it stays on your machine, with no account.",
    tools: ["timer", "todos", "notes", "water", "scratchpad"],
    start: "timer",
    image: { src: "img/timer-looks.png", alt: "The Timer tool in three looks, with big pixel digits", w: 1200, h: 434 },
  },
  {
    id: "clipboard",
    hue: "teal",
    title: "Clipboard, Shelf, Converter, Launcher",
    text:
      "The clipboard keeps text, links, images and files with filters, never writes them to disk and skips password managers. The Shelf parks files you drop or paste. The Converter handles units and about 30 currencies at the European Central Bank rates. The Launcher starts your pinned apps, and the first six also answer to Alt + 1 to Alt + 6.",
    next: "Coming in 1.0: send Shelf files to a phone on the same network by scanning a QR code.",
    tools: ["clipboard", "shelf", "convert", "launcher"],
    start: "clipboard",
  },
  {
    id: "capture",
    hue: "cyan",
    title: "Capture, record, look",
    text:
      "Screenshots of every screen, one screen or a region. Recordings of a screen or a window at 30 or 60 fps with system audio and the microphone. A sound-only Recorder that keeps every voice of a call. A mirror to check the light before a meeting, and Find on screen, which reads the text on all your screens with Windows' own recognition and lets you search it. Crest keeps itself out of its own captures.",
    tools: ["capture", "recorder", "camera", "find"],
    start: "capture",
    note: "The demo shows the panels. Your camera, screen and microphone are never touched here.",
    image: { src: "img/find-on-screen.png", alt: "Find on screen searching for the word invoice and highlighting the line that contains it", w: 1200, h: 640 },
  },
  {
    id: "ai",
    hue: "violet",
    title: "Ask and AI usage",
    text:
      "Ask is a chat with Claude, ChatGPT, OpenRouter or any OpenAI-compatible endpoint, with streaming and adjustable reasoning effort, using your own key. AI usage shows your subscription limits and balances in one place, plus the tokens and cost of your local coding agents today and over a week, with a page per model. A reading that is out of date is dimmed, and an expired sign-in renews from Crest's terminal in one click.",
    tools: ["ask", "usage"],
    start: "ask",
    image: { src: "img/ai-usage-renew.png", alt: "AI usage with a dimmed card whose sign-in expired and a Renew in the terminal link", w: 1200, h: 640 },
  },
  {
    id: "system",
    hue: "red",
    title: "Hardware, Terminal, GitHub",
    text:
      "Hardware reads CPU, RAM, GPU, VRAM, network, power, battery, temperatures, ping, the busiest processes and your drives, with history that keeps recording while the notch is shut, and FPS for games. The Terminal runs PowerShell or Command Prompt inside the notch. GitHub shows the contribution calendar of a public user for the last 36 weeks, with streaks.",
    tools: ["system", "terminal", "github"],
    start: "system",
    note: "The readings in the demo are sample values.",
  },
  {
    id: "life",
    hue: "emerald",
    title: "Calendar, portfolio, vault, Discord",
    text:
      "A read-only agenda from ICS links or CalDAV, with a notice before each event and a Join button for Meet, Zoom, Teams and Webex. A portfolio that adds several brokers into one currency and only ever reads. A vault for passwords and 2FA codes behind a PIN, encrypted on your PC. Your Discord voice call with mute, deafen and hang up.",
    tools: ["calendar", "trading", "vault", "discord"],
    start: "calendar",
    image: { src: "img/calendar-join.png", alt: "The Calendar agenda with a Join button on an event", w: 1200, h: 640 },
  },
  {
    id: "themes",
    hue: "purple",
    title: "Fifteen themes",
    text:
      "Fifteen built-in themes from Dark and Light to Dracula, Nord and Gruvbox, an editor with a colour picker, your own themes saved and shared as JSON files, and a switch between a day and a night theme by the clock. The closed notch stays black unless a theme opts in. Coloured icons give every tool its own hue, the way this page does.",
    controls: ["themes"],
    start: "overview",
  },
  {
    id: "yours",
    hue: "indigo",
    title: "Your language, pets and settings",
    text:
      "Crest speaks eleven languages, Arabic read right to left, and switches at once. A short first-run setup picks a preset (Music, Productivity, AI or your own), the closed look and the edge. Settings has a search field (Ctrl + F) that finds a setting by name, description or group.",
    next: "Coming in 1.0: eight cartoon pets that live in a nest beside the notch.",
    controls: ["langs", "pets", "pages"],
    start: "settings",
    note: "In Settings, press Ctrl + F to search.",
    image: { src: "img/settings-search.png", alt: "Settings search finding a setting by its name", w: 1200, h: 800 },
  },
];

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
  { tab: "Demo", q: "Is the demo the real app?", a: "It is the real interface, built for the web and filled with sample data. Anything that needs your PC (hardware readings, the camera, your files, Windows notifications) is simulated here, so the demo shows how it looks and moves, not your own data. It runs the version in development, so it also shows what the page marks as coming in 1.0, which the 0.4.0 download does not have yet." },
  { tab: "Systems", q: "What does it run on?", a: "Windows 11 and Windows 10, on x64 and on ARM, and macOS 12 or later on Apple silicon and Intel as a preview. Shelf, Hardware, Discord, Vault, Terminal, Launcher, Notices, Capture, Recorder and Camera are Windows-only for now and do not show on a Mac." },
  { tab: "Network", q: "What does it send over the network?", a: "Nothing goes to the developer. Crest only goes online for the services you turn on, such as the weather, currency rates, lyrics or your AI provider, and straight from your PC to them. The full table is in the privacy policy." },
  { tab: "Store", q: "Microsoft Store or GitHub?", a: "The Store build is signed by Microsoft and updated by the Store. The installer and the portable zip on GitHub are not code-signed yet, so SmartScreen may warn on first launch: choose More info, then Run anyway." },
  { tab: "Plugins", q: "Can I add my own tools?", a: "Yes. A plugin is a folder of HTML, CSS and JavaScript with a crest-plugin.json. Crest lists what it asks for before you install it, and it runs sandboxed with only the network addresses and storage it declares." },
];
