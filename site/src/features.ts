/**
 * Everything Crest does, in the groups of the README's Features, for the home page's catalogue: pick a name, see it and read it.
 * A picture is either one of the demo's own captures in ./shots (`shot`) or a file in public/img (`img`), with its size in CSS px.
 * `win`: Windows only. `noStore`: not in the Microsoft Store version for now. `fresh`: the release it came in, while it is recent.
 * `demo`: the demo can show it (the link opens the full-screen desktop); left out when it cannot.
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
      { name: "Live previews and jump lists", text: "Rest the pointer on an app and its windows show as live previews, as in Windows 11. A right click brings the app's jump list, with its tasks and recent files.", img: "/img/cat/bar-preview.webp", w: 760, h: 250, alt: "Two live previews of File Explorer windows over Crest's taskbar", win: true, noStore: true },
      { name: "Shapes, transparency and glass", text: "Docked along the whole edge, floating, a capsule as wide as its buttons, or tiles, at the height and icon size you like, as opaque or as clear as you want. Liquid Glass + draws a strong lens along the edge over a live copy of the screen, on Windows 11 24H2 and later on x64.", img: "/img/cat/bar-right.webp", w: 720, h: 140, alt: "The right end of Crest's taskbar over a blue wallpaper, the picture showing through it, with the battery charging and the clock", win: true, noStore: true },
      { name: "Status", text: "The network, the volume and the battery as one button, drawn as on an iPhone, with a quick panel for Wi-Fi, Bluetooth, volume and brightness.", img: "/img/cat/bar-status.webp", w: 560, h: 460, alt: "The quick panel over the taskbar: Wi-Fi, Bluetooth, volume, brightness and quick switches", win: true, noStore: true },
      { name: "Search or open", text: "Apps, tools, settings with a value, widgets, files from Windows' index and quick answers, from the bar's search box or a shortcut. With Ask, a sentence becomes an action.", img: "/img/cat/search.webp", w: 460, h: 530, alt: "The bar's search panel open over the desktop, with Calculator found for calc and the search box on the bar under it", win: true, noStore: true, fresh: "1.4" },
    ],
  },
  {
    name: "The closed notch",
    hue: "#ff9a4d",
    entries: [
      { name: "Three looks, four edges", text: "A notch that hugs the edge, a capsule you drag to any height, or a thin line with the song's progress, on the top, bottom, left or right edge.", img: "/img/cat/looks.webp", w: 694, h: 358, alt: "The closed notch in its three looks over a wallpaper: the notch, the capsule and the thin line", demo: "closed" },
      { name: "The row", text: "The parts you pick, in your order: cover, timer, the lyric line, AI quota rings, CPU, RAM, GPU, network, battery, clock, weather, the next event and parts your own scripts set.", shot: "closed", w: 732, h: 42, alt: "The closed notch with a running timer, quota rings, CPU, memory and GPU, the clock and the weather", demo: "closed" },
      { name: "Notices", text: "A finished timer, a due to-do, a meeting about to start, a download, a quota alert, the charger, Bluetooth or Caps Lock take the row for a moment, then go back.", img: "/img/cat/notices-row.webp", w: 406, h: 234, alt: "Two notices in the closed notch: a meeting about to start with a join button, and a finished timer", demo: "closed" },
      { name: "A pet", text: "Eight cartoon pets for a nest beside the notch. The black cat dances to the music and runs faster when the CPU is busy.", shot: "pet", w: 632, h: 58, alt: "A black cat in its nest beside the closed notch", demo: "yours" },
    ],
  },
  {
    name: "Music",
    hue: "#ff48b0",
    entries: [
      { name: "Now Playing", text: "Any player with a Windows media session, with the cover, progress, a live equalizer and a mixer for every app.", img: "/img/cat/media.webp", w: 767, h: 241, alt: "Now Playing with the cover, the progress bar and the controls", demo: "music" },
      { name: "Synced lyrics", text: "Word by word where the source times words, also in the closed notch. Translation and romanisation of Japanese, Chinese and Korean.", img: "/img/cat/lyrics.webp", w: 767, h: 477, alt: "Now Playing with synced lyrics, the line being sung lighting up word by word", demo: "music" },
      { name: "Discord", text: "Your voice call with who is talking, and buttons to mute, deafen and hang up.", img: "/img/cat/discord.webp", w: 767, h: 219, alt: "A Discord voice call in the notch, with who is in it and buttons to mute, deafen and hang up", win: true },
    ],
  },
  {
    name: "Time and focus",
    hue: "#ff7c2f",
    entries: [
      { name: "Timer", text: "Focus and break presets, six alarm sounds, rain or noise behind it and a dozen looks, from pixel digits to a flip clock.", img: "/img/timer-looks.png", w: 660, h: 460, alt: "The Timer in several of its looks", demo: "focus" },
      { name: "Screen Time", text: "Off until you turn it on: which apps you use and for how long, hour by hour, kept 30 days on your PC only, with a timeline of the day.", img: "/img/screen-time.webp", w: 748, h: 352, alt: "Screen Time with the apps of the day and the hours", fresh: "1.3.2" },
      { name: "Calendar", text: "ICS links from Google, Outlook or iCloud, or CalDAV, with a notice before each event and a join button for online meetings.", img: "/img/cat/calendar.webp", w: 767, h: 348, alt: "The Calendar with the month and today's and tomorrow's events", demo: "life" },
      { name: "Clocks, habits, water", text: "Up to 12 cities with sunrise and sunset, habits with a streak that forgives the odd missed day, and water against a daily goal.", img: "/img/cat/clocks.webp", w: 767, h: 381, alt: "Clocks with a city, sunrise and sunset and the moon", demo: "focus" },
    ],
  },
  {
    name: "Writing and files",
    hue: "#00a6a6",
    entries: [
      { name: "To-dos and notes", text: "Projects, due times and reminders. Type \"call Marco tomorrow 9am\" and the task gets the time. Notes save as you type.", img: "/img/cat/todos.webp", w: 767, h: 285, alt: "To-dos with projects and due times", demo: "focus" },
      { name: "Clipboard", text: "Text, links, images and files, never written to disk. Password managers are left out on purpose.", img: "/img/cat/clipboard.webp", w: 767, h: 245, alt: "The clipboard history with an image, a link and text", demo: "clipboard" },
      { name: "Shelf and Send to phone", text: "Drop files on the notch to park them, then scan a QR code and the phone downloads them from your PC over your own network.", img: "/img/cat/shelf.webp", w: 767, h: 245, alt: "The Shelf with four files and Send to phone", win: true, demo: "clipboard" },
      { name: "Translate", text: "Text translated on your PC with the lyrics' offline models, in ten languages, or by the Ask provider when you allow it.", img: "/img/cat/translate.webp", w: 767, h: 348, alt: "Translate with a Spanish sentence, the language detected, and its English translation", fresh: "1.4" },
      { name: "Prompter", text: "A teleprompter that scrolls your script at the speed you set, with a mirror mode.", img: "/img/cat/teleprompter.webp", w: 767, h: 348, alt: "The Prompter with a short script and its word count" },
    ],
  },
  {
    name: "Pomelo",
    hue: "#ff8a3d",
    entries: [
      { name: "Files", text: "Convert and edit images, PDFs, audio and video with Pomelo's conversions and tools. The originals never change; the results land beside them or on the Shelf. 20 files free, then a key for US$4.99 once.", img: "/img/cat/files.webp", w: 767, h: 348, alt: "The Files tool with four sample files from the Shelf and its actions", win: true, fresh: "1.4" },
      { name: "Pomelo wheel", text: "Drag files in File Explorer, hold Shift, Ctrl or Alt, and Pomelo's wheel of conversions appears. Off until you turn it on in the Pomelo page of the settings.", img: "/img/cat/pomelo.webp", w: 767, h: 468, alt: "The Pomelo page of the settings, with the switch for the Pomelo wheel", win: true, fresh: "1.4" },
    ],
  },
  {
    name: "Everyday tools",
    hue: "#3d7bff",
    entries: [
      { name: "Overview", text: "Time, weather, the song, focus, keep awake, volume, brightness and quick switches, in one panel.", img: "/img/cat/overview.webp", w: 767, h: 365, alt: "Overview with the time, the weather and quick controls", demo: "overview" },
      { name: "Weather", text: "Now, hour by hour and for the week, from Open-Meteo, with no key and no account.", img: "/img/cat/weather.webp", w: 767, h: 338, alt: "Weather now, hour by hour and for the week", demo: "overview" },
      { name: "Calc and Converter", text: "A notebook calculator that reads units, dates and percentages, and about 160 currencies at central bank rates.", img: "/img/cat/convert.webp", w: 767, h: 219, alt: "The Converter turning centimetres into inches", demo: "clipboard" },
      { name: "Portfolio", text: "Trading 212, Kraken, Coinbase and more, added up in one currency with keys that can only read.", img: "/img/cat/trading.webp", w: 767, h: 388, alt: "The Portfolio adding up two brokers in euros", demo: "life" },
      { name: "Colour", text: "Pick a colour anywhere on the screen, copy it as HEX, RGB, HSL or OKLCH, and check its contrast.", img: "/img/cat/colour.webp", w: 767, h: 428, alt: "Colour with a purple picked, in HEX, RGB, HSL and OKLCH" },
    ],
  },
  {
    name: "For developers",
    hue: "#ff665e",
    entries: [
      { name: "Hardware", text: "CPU, GPU, RAM, network, power, temperatures, the busiest processes and FPS in games, plus the ports your PC listens on.", img: "/img/cat/system.webp", w: 767, h: 388, alt: "Hardware with CPU, RAM, GPU, network, power, battery and the busiest processes", win: true, demo: "system" },
      { name: "AI usage and Ask", text: "Your limits for Claude, ChatGPT, Cursor and more, with where each is heading, and a chat with your own key or a model on your PC.", img: "/img/cat/usage.webp", w: 767, h: 427, alt: "AI Usage with the limits of four providers", demo: "ai" },
      { name: "Terminal and Agents", text: "PowerShell or Command Prompt inside the notch, and the coding agent sessions running on your PC with what each one waits for.", img: "/img/cat/agents.webp", w: 767, h: 329, alt: "Agents with four coding sessions and what each one waits for", win: true },
      { name: "GitHub and LeetCode", text: "Activity calendars and streaks of any public user, with today's count.", img: "/img/cat/github.webp", w: 767, h: 245, alt: "A GitHub contribution calendar with the streak", demo: "system" },
      { name: "crest-notify", text: "Scripts and builds send notices, ask a question with buttons, or put their own part in the closed row.", img: "/img/cat/ask.webp", w: 746, h: 159, alt: "A question from a coding agent in the closed notch, with Allow, Always allow and Deny" },
    ],
  },
  {
    name: "Capture",
    hue: "#3ec7ff",
    entries: [
      { name: "Screenshots and recordings", text: "Every screen, one screen or a region, and recordings with system audio and the microphone.", img: "/img/cat/capture.webp", w: 767, h: 344, alt: "Capture with the screenshot and video options and recent captures", win: true },
      { name: "Find on screen", text: "Reads the text on every screen and searches it.", img: "/img/find-on-screen.png", w: 600, h: 320, alt: "Find on screen with a match highlighted", win: true },
      { name: "Recorder and Camera", text: "Sound from the microphone, the system or both, and the camera as a mirror before a call.", img: "/img/cat/recorder.webp", w: 767, h: 289, alt: "The Recorder with a recording of today", win: true },
    ],
  },
  {
    name: "Make it yours",
    hue: "#c069ff",
    entries: [
      { name: "Crest or Material", text: "Two styles for the whole app: the black Crest you know, or Material, with colours from your theme and soft shapes.", img: "/img/settings-material.webp", w: 800, h: 524, alt: "The settings window in the Material style on Themes", demo: "themes" },
      { name: "Fifteen themes", text: "Dracula, Nord, Catppuccin, Gruvbox and more, an editor for your own, sixteen fonts and a day and night switch that can follow the sun.", img: "/img/cat/themes.webp", w: 1194, h: 546, alt: "Overview in six themes: Dark, Light, Dracula, Nord, Catppuccin Latte and Gruvbox Dark", demo: "themes" },
      { name: "Wallpapers", text: "Off until you turn it on: 24 pictures or your own folder, per screen, changing on their own every 15 minutes, hour or day.", img: "/img/wallpapers.webp", w: 561, h: 339, alt: "The Wallpapers tool with the collection", fresh: "1.3.2" },
      { name: "Eleven languages", text: "English, Simplified Chinese, Spanish, Hindi, Arabic right to left, French, Portuguese, Russian, Japanese, German and Italian.", img: "/img/cat/languages.webp", w: 767, h: 365, alt: "Overview in Japanese", demo: "yours" },
      { name: "Plugins", text: "Your own tools in HTML, CSS and JavaScript, sandboxed, with only the addresses and storage they declare.", img: "/img/cat/plugin.webp", w: 767, h: 258, alt: "Hello Crest, a sample plugin, as a tool of its own in the notch" },
    ],
  },
];
