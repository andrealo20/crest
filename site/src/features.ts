/**
 * Everything Crest does, in the groups of the README's Features, for the home page's catalogue: pick a name, see it and read it.
 * A picture is either one of the demo's own captures in ./shots (`shot`) or a file in public/img (`img`), with its size in CSS px.
 * `win`: Windows only. `noStore`: not in the Microsoft Store version for now. `fresh`: the release it came in, while it is recent.
 * `demo`: the chapter of /try/ that shows it; left out when the browser demo cannot.
 */
export interface Entry {
  name: string;
  text: string;
  tool?: string;
  shot?: string;
  img?: string;
  w?: number;
  h?: number;
  alt?: string;
  win?: true;
  noStore?: true;
  fresh?: string;
  demo?: string;
}

export interface Group {
  name: string;
  hue: string;
  entries: Entry[];
}

export const CATALOG: Group[] = [
  {
    name: "The taskbar",
    hue: "#4fa8ff",
    entries: [
      { name: "A taskbar of its own", text: "Windows' Start, your pinned apps and open windows, the notification area and the Crest menu, on every monitor. Off by default; turn it off, or quit Crest, and the Windows taskbar comes back.", img: "/img/desktop.webp", w: 960, h: 600, alt: "A Windows desktop with the notch open on Hardware at the top and Crest's taskbar along the bottom", win: true, noStore: true },
      { name: "Widgets", text: "Weather, clocks, hardware, the timer, Now Playing, top apps, batteries, temperatures, disk space, world time, currencies, crypto, Screen Time and unread notifications, each in the version you pick, dragged anywhere along the bar.", img: "/img/bar.webp", w: 1440, h: 64, alt: "Crest's taskbar: CPU, memory and GPU, the weather and the AI quota rings on the left, Start and the apps in the middle, the timer, the tray, Wi-Fi, volume and the battery charging at 64 percent, and the clock on the right", win: true, noStore: true, fresh: "1.3.2" },
      { name: "Folders", text: "Hold a pinned app over another for half a second and both go into a folder, which opens in a panel over the bar. Drag apps in and out, rename it, or ungroup it.", img: "/img/folder-1.3.2.webp", w: 640, h: 184, alt: "A folder called Creative open over Crest's taskbar, with four app icons", win: true, noStore: true, fresh: "1.3.2" },
      { name: "Live previews and jump lists", text: "Rest the pointer on an app and its windows show as live previews, as in Windows 11. A right click brings the app's jump list, with its tasks and recent files.", win: true, noStore: true },
      { name: "Shapes and Liquid Glass +", text: "Docked along the whole edge, floating, a capsule as wide as its buttons, or tiles, at the height and icon size you like. Liquid Glass + draws a strong lens along the edge over a live copy of the screen, on Windows 11 24H2 and later on x64.", win: true, noStore: true },
      { name: "Status", text: "The network, the volume and the battery as one button, drawn as on an iPhone, with a quick panel for Wi-Fi, Bluetooth, volume and brightness.", win: true, noStore: true },
    ],
  },
  {
    name: "The closed notch",
    hue: "#ff9a4d",
    entries: [
      { name: "Three looks, four edges", text: "A notch that hugs the edge, a capsule you drag to any height, or a thin line with the song's progress, on the top, bottom, left or right edge.", img: "/img/bottom-edge.png", w: 780, h: 548, alt: "The notch on the bottom edge of the screen", demo: "closed" },
      { name: "The row", text: "The parts you pick, in your order: cover, timer, the lyric line, AI quota rings, CPU, RAM, GPU, network, battery, clock, weather, the next event and parts your own scripts set.", shot: "closed", w: 732, h: 42, alt: "The closed notch with a running timer, quota rings, CPU, memory and GPU, the clock and the weather", demo: "closed" },
      { name: "Notices", text: "A finished timer, a due to-do, a meeting about to start, a download, a quota alert, the charger, Bluetooth or Caps Lock take the row for a moment, then go back.", img: "/img/closed-notch.png", w: 611, h: 28, alt: "A notice in the closed notch", demo: "closed" },
      { name: "A pet", text: "Eight cartoon pets for a nest beside the notch. The black cat dances to the music and runs faster when the CPU is busy.", shot: "pet", w: 632, h: 58, alt: "A black cat in its nest beside the closed notch", demo: "yours" },
    ],
  },
  {
    name: "Music",
    hue: "#ff48b0",
    entries: [
      { name: "Now Playing", text: "Any player with a Windows media session, with the cover, progress, a live equalizer and a mixer for every app.", shot: "media", w: 520, h: 232, alt: "Now Playing with the cover, the progress bar and the controls", demo: "music" },
      { name: "Synced lyrics", text: "Word by word where the source times words, also in the closed notch. Translation and romanisation of Japanese, Chinese and Korean.", img: "/img/now-playing-styles.png", w: 520, h: 232, alt: "Now Playing in its looks, with lyrics", demo: "music" },
      { name: "Discord", text: "Your voice call with who is talking, and buttons to mute, deafen and hang up.", tool: "discord", win: true },
    ],
  },
  {
    name: "Time and focus",
    hue: "#ff7c2f",
    entries: [
      { name: "Timer", text: "Focus and break presets, six alarm sounds, rain or noise behind it and a dozen looks, from pixel digits to a flip clock.", img: "/img/timer-looks.png", w: 660, h: 460, alt: "The Timer in several of its looks", demo: "focus" },
      { name: "Screen Time", text: "Off until you turn it on: which apps you use and for how long, hour by hour, kept 30 days on your PC only, with a timeline of the day.", img: "/img/screen-time.webp", w: 748, h: 352, alt: "Screen Time with the apps of the day and the hours", fresh: "1.3.2" },
      { name: "Calendar", text: "ICS links from Google, Outlook or iCloud, or CalDAV, with a notice before each event and a join button for online meetings.", img: "/img/calendar-join.png", w: 560, h: 340, alt: "A meeting notice with a Join button", demo: "life" },
      { name: "Clocks, habits, water", text: "Up to 12 cities with sunrise and sunset, habits with a streak that forgives the odd missed day, and water against a daily goal.", tool: "clocks", demo: "focus" },
    ],
  },
  {
    name: "Writing and files",
    hue: "#00a6a6",
    entries: [
      { name: "To-dos and notes", text: "Projects, due times and reminders. Type \"call Marco tomorrow 9am\" and the task gets the time. Notes save as you type.", shot: "todos", w: 600, h: 276, alt: "To-dos with projects and due times", demo: "focus" },
      { name: "Clipboard", text: "Text, links, images and files, never written to disk. Password managers are left out on purpose.", shot: "clipboard", w: 600, h: 236, alt: "The clipboard history", demo: "clipboard" },
      { name: "Shelf and Send to phone", text: "Drop files on the notch to park them, then scan a QR code and the phone downloads them from your PC over your own network.", shot: "shelf", w: 560, h: 236, alt: "The Shelf with a QR code for the phone", win: true, demo: "clipboard" },
      { name: "Prompter", text: "A teleprompter that scrolls your script at the speed you set, with a mirror mode.", tool: "teleprompter" },
    ],
  },
  {
    name: "Everyday tools",
    hue: "#3d7bff",
    entries: [
      { name: "Overview", text: "Time, weather, the song, focus, keep awake, volume, brightness and quick switches, in one panel.", shot: "overview", w: 520, h: 356, alt: "Overview with the time, the weather and quick controls", demo: "overview" },
      { name: "Weather", text: "Now, hour by hour and for the week, from Open-Meteo, with no key and no account.", shot: "weather", w: 640, h: 330, alt: "Weather with the hours ahead and seven days", demo: "overview" },
      { name: "Calc and Converter", text: "A notebook calculator that reads units, dates and percentages, and about 160 currencies at central bank rates.", shot: "convert", w: 520, h: 210, alt: "The Converter turning pounds into euros", demo: "clipboard" },
      { name: "Portfolio", text: "Trading 212, Kraken, Coinbase and more, added up in one currency with keys that can only read.", shot: "trading", w: 560, h: 380, alt: "The Portfolio adding up two brokers in euros", demo: "life" },
      { name: "Colour", text: "Pick a colour anywhere on the screen, copy it as HEX, RGB, HSL or OKLCH, and check its contrast.", tool: "colour" },
    ],
  },
  {
    name: "For developers",
    hue: "#ff665e",
    entries: [
      { name: "Hardware", text: "CPU, GPU, RAM, network, power, temperatures, the busiest processes and FPS in games, plus the ports your PC listens on.", shot: "system", w: 720, h: 380, alt: "Hardware with graphs for every part of the PC", win: true, demo: "system" },
      { name: "AI usage and Ask", text: "Your limits for Claude, ChatGPT, Cursor and more, with where each is heading, and a chat with your own key or a model on your PC.", shot: "ask", w: 560, h: 440, alt: "Ask, a chat inside the notch", demo: "ai" },
      { name: "Terminal and Agents", text: "PowerShell or Command Prompt inside the notch, and the coding agent sessions running on your PC with what each one waits for.", tool: "terminal", win: true },
      { name: "GitHub and LeetCode", text: "Activity calendars and streaks of any public user, with today's count.", shot: "github", w: 520, h: 236, alt: "GitHub contributions for 36 weeks", demo: "system" },
      { name: "crest-notify", text: "Scripts and builds send notices, ask a question with buttons, or put their own part in the closed row.", tool: "notices" },
    ],
  },
  {
    name: "Capture",
    hue: "#3ec7ff",
    entries: [
      { name: "Screenshots and recordings", text: "Every screen, one screen or a region, and recordings with system audio and the microphone.", img: "/img/capture.webp", w: 620, h: 336, alt: "The Capture tool", win: true },
      { name: "Find on screen", text: "Reads the text on every screen and searches it.", img: "/img/find-on-screen.png", w: 600, h: 320, alt: "Find on screen with a match highlighted", win: true },
      { name: "Recorder and Camera", text: "Sound from the microphone, the system or both, and the camera as a mirror before a call.", tool: "camera", win: true },
    ],
  },
  {
    name: "Make it yours",
    hue: "#c069ff",
    entries: [
      { name: "Crest or Material", text: "Two styles for the whole app: the black Crest you know, or Material, with colours from your theme and soft shapes.", img: "/img/settings-material.webp", w: 800, h: 524, alt: "The settings window in the Material style on Themes", demo: "themes" },
      { name: "Fifteen themes", text: "Dracula, Nord, Catppuccin, Gruvbox and more, an editor for your own, sixteen fonts and a day and night switch that can follow the sun.", shot: "theme-dracula", w: 520, h: 356, alt: "Overview in the Dracula theme", demo: "themes" },
      { name: "Wallpapers", text: "Off until you turn it on: 24 pictures or your own folder, per screen, changing on their own every 15 minutes, hour or day.", img: "/img/wallpapers.webp", w: 561, h: 339, alt: "The Wallpapers tool with the collection", fresh: "1.3.2" },
      { name: "Eleven languages", text: "English, Simplified Chinese, Spanish, Hindi, Arabic right to left, French, Portuguese, Russian, Japanese, German and Italian.", tool: "clocks", demo: "yours" },
      { name: "Plugins", text: "Your own tools in HTML, CSS and JavaScript, sandboxed, with only the addresses and storage they declare.", tool: "launcher" },
    ],
  },
];
