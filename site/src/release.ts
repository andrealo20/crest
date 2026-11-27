/**
 * What the latest release brings, for the home page and What's new. Each item points at the chapter of the home page whose demo
 * shows it. The full list of every version comes from src/changelog.json, the one the app shows.
 */
export const RELEASE = "1.4";

/**
 * The release's short film, from public/media. The page shows it only once both files are there at build time (vite.config.ts
 * lists the folder, so a running dev server needs a restart), and a build without them has no empty player. Set width and height
 * to the clip's own size. Liquid Glass + keeps the bar out of every screen recording, so write the caption from the final cut.
 */
export const FILM = {
  /** The version it shows: on the home page and at the top of What's new only while that is the latest release, else under its version. */
  version: "1.3.0",
  src: "/media/crest-1.3.mp4",
  poster: "/media/crest-1.3.jpg",
  width: 1920,
  height: 1080,
  caption: "Crest 1.3: Liquid Glass + on the bar, live window previews, the Crest menu, widgets dragged along the bar and the Material style. A bar with Liquid Glass + stays out of every screen recording, so here Crest's own code draws it over a recording of the desktop.",
};
/** The film belongs to the latest release. */
export const FILM_IS_NEW = FILM.version.startsWith(`${RELEASE}.`);
export const HAS_FILM = [FILM.src, FILM.poster].every((f) => __SITE_MEDIA__.includes(f.replace("/media/", "")));

/** `demo: false`: the browser demo cannot show it, so the card only leads to the chapter. `link`: a page elsewhere, shown in its place. */
export const HIGHLIGHTS: { title: string; text: string; chapter: string; hue: string; demo?: false; link?: { href: string; label: string } }[] = [
  {
    title: "Search or open",
    text: "The search box on Crest's taskbar finds apps, also by their initials, Crest's tools, settings with a value (\"volume 30\"), widgets, and files and folders from Windows' index with a preview. It answers sums, currency and unit conversions and the time in a city, and sends anything else to the web. With a provider set up in Ask, a sentence in any language becomes an action. A shortcut opens it from any app. On Windows, not in the Microsoft Store version.",
    chapter: "yours",
    hue: "#4fa8ff",
    demo: false,
  },
  {
    title: "Pomelo comes to Crest",
    text: "Files, a new tool, converts and edits images, PDFs, audio and video with Pomelo's conversions and tools: drop them on the open tool or take them from the Shelf, and the results land beside the originals, which never change. The Pomelo wheel, in the settings window, brings Pomelo's wheel to files you drag in File Explorer while you hold Shift, Ctrl or Alt. Both run on Pomelo's engine, a separate closed-source program the GitHub versions download only when you ask, and the Microsoft Store version carries in its package. 20 files are free, then 2 a day; a key is US$4.99 once until 31 December 2026, then US$9.99. On Windows.",
    chapter: "yours",
    hue: "#ff8a3d",
    demo: false,
    link: { href: "https://pomeloapp.net", label: "Pomelo's site" },
  },
  {
    title: "Translate",
    text: "A new tool translates text on your PC with the same offline models as the lyrics, in ten languages, a moment after you stop typing. A pair with no model can go to the provider set up in Ask, only when you allow it.",
    chapter: "clipboard",
    hue: "#00a6a6",
    demo: false,
  },
  {
    title: "Stocks and your Portfolio on the bar",
    text: "The crypto widget also shows a stock, fund or index by its Yahoo Finance symbol, or your Portfolio's total, over today, a week, a month or a year. Battery, Wi-Fi and volume are drawn as on an iPhone and a Mac, the battery with its percentage beside it.",
    chapter: "yours",
    hue: "#00c26a",
    demo: false,
  },
  {
    title: "Room for the bar, on every screen",
    text: "Floating, Capsule and Tiles can keep room for the bar, so maximized windows end above it, and Start opens above it over a full-screen game too. With Auto-hide, Only on the screen you're working on lets just the bar in use slide away.",
    chapter: "yours",
    hue: "#7b61ff",
    demo: false,
  },
  {
    title: "Behind other windows",
    text: "Settings, Window can keep the notch on the desktop, under every window; the shortcut still brings it to the front. The tool bar shows the selected tool's name, Overview gets Hibernate when hibernation is on, and Material gets Pure black and its own shapes.",
    chapter: "yours",
    hue: "#ff48b0",
    demo: false,
  },
];

export const FIXES = [
  "With Windows keys on the bar on, Crest no longer restarts Explorer as it starts, which crashed the taskbar on some Windows builds.",
  "The Recycle Bin widget stays up to date after Explorer restarts.",
  "The floating timer follows the window rules like the notch, thanks to Anton Matis.",
  "A daily install count, with no ID, public on the Stats page. Count this install, in Settings, General, Updates, turns it off.",
];
