/**
 * What the latest release brings, for the home page and What's new. Each item points at the chapter of the home page whose demo
 * shows it. The full list of every version comes from src/changelog.json, the one the app shows.
 */
export const RELEASE = "1.1";

/** `demo: false`: the browser demo cannot show it, so the card only leads to the chapter. */
export const HIGHLIGHTS: { title: string; text: string; chapter: string; hue: string; demo?: false }[] = [
  {
    title: "A shortcut for every tool",
    text: "Settings, Window can give any tool in the dock a key combination. It opens the notch on that tool from anywhere, switches to it, or closes the notch when the tool already shows.",
    chapter: "yours",
    hue: "#ffb511",
    demo: false,
  },
  {
    title: "Crest's own eyedropper",
    text: "Colour now freezes every monitor and shows a loupe under the pointer, so the pick stays on the pixel on screens with different scaling. On a Mac it uses the system's colour sampler, with no screen recording permission.",
    chapter: "extras",
    hue: "#c069ff",
  },
  {
    title: "Backup and restore",
    text: "Settings, General saves your settings, notes, to-dos and the tools' data to one file in Documents, Crest, Backups. A restore keeps a copy of what it replaces. Keys, passwords, calendar links and the vault never go into the file.",
    chapter: "yours",
    hue: "#00c26a",
    demo: false,
  },
  {
    title: "Search the web from Overview",
    text: "An optional line at the bottom of Overview opens your search in the browser, with Google, Bing, DuckDuckGo or Brave Search. It is off until you pick an engine.",
    chapter: "overview",
    hue: "#4fa8ff",
  },
  {
    title: "Ask with a model on your PC",
    text: "Point Ask at LM Studio, Ollama or any local server and it works without a key. The chat then never leaves your computer.",
    chapter: "ai",
    hue: "#9d7aff",
  },
  {
    title: "Panel scale from 80 to 200 percent",
    text: "Eight steps between 80 and 200 percent, for a 4K screen or a small laptop. The panel, its text and its sizes all grow together.",
    chapter: "yours",
    hue: "#ff7c2f",
  },
  {
    title: "The cover behind the whole panel",
    text: "The Music tool can spread the album cover, blurred and darkened, behind the controls and the lyrics.",
    chapter: "music",
    hue: "#ff48b0",
  },
  {
    title: "About 160 currencies",
    text: "The Converter and Calc take their rates from Frankfurter's second version, which adds the rates of many central banks to the European Central Bank's 30 currencies.",
    chapter: "clipboard",
    hue: "#ff5c87",
  },
];

export const FIXES = [
  "Windows' empty banner window no longer takes clicks above the tray or keeps an auto-hidden taskbar down.",
  "A new track starts at zero in players that keep the last track's timeline.",
  "A file dragged out of the Shelf drops into the app under the panel.",
  "The FPS error stays on screen while Crest tries again.",
];
