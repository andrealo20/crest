/**
 * What the latest release brings, for the home page and What's new. Each item points at the chapter of the home page whose demo
 * shows it. The full list of every version comes from src/changelog.json, the one the app shows.
 */
export const RELEASE = "1.3";

/**
 * The release's short film, from public/media. The page shows it only once both files are there at build time (vite.config.ts
 * lists the folder, so a running dev server needs a restart), and a build without them has no empty player. Set width and height
 * to the clip's own size. Liquid Glass + keeps the bar out of every screen recording, so write the caption from the final cut.
 */
export const FILM = {
  src: "/media/crest-1.3.mp4",
  poster: "/media/crest-1.3.jpg",
  width: 1920,
  height: 1080,
  caption: "Crest 1.3: Liquid Glass + on the bar, live window previews, the Crest menu, widgets dragged along the bar and the Material style. A bar with Liquid Glass + stays out of every screen recording, so here Crest's own code draws it over a recording of the desktop.",
};
export const HAS_FILM = [FILM.src, FILM.poster].every((f) => __SITE_MEDIA__.includes(f.replace("/media/", "")));

/** `demo: false`: the browser demo cannot show it, so the card only leads to the chapter. */
export const HIGHLIGHTS: { title: string; text: string; chapter: string; hue: string; demo?: false }[] = [
  {
    title: "Crest's own taskbar",
    text: "On Windows, Crest can take the place of the taskbar with a bar in its own style (off by default, not in the Microsoft Store version). Settings, Taskbar, Appearance sets its shape: Docked, Floating, Capsule or Tiles. Pinned apps and open windows sit on it, and resting the pointer on an app shows a live preview of each of its windows. Next to them come the Notification area, tool buttons and widgets made from the notch's tools, and a widget drags along the bar to a new place. Turn it off and the Windows taskbar is back.",
    chapter: "yours",
    hue: "#4fa8ff",
    demo: false,
  },
  {
    title: "Liquid Glass + on the bar",
    text: "A third choice for the bar's Glass draws it the way the widgets of LiquidGlassWindows draw theirs: a strong lens along the edge, red and blue a little apart, almost no blur and white content, over a copy of the screen renewed up to 10 times a second. It needs Windows 11 24H2 or later on x64 and is not in the Microsoft Store version for now. While it is chosen the bar stays out of screenshots, recordings and screen shares.",
    chapter: "yours",
    hue: "#9d7aff",
    demo: false,
  },
  {
    title: "The Material style",
    text: "Settings, Themes, Style turns every Crest window into Material 3, on Windows and on the Mac: colours worked out from your theme, text in Google Sans Flex, Material Symbols icons and Material's springs. Weather and Hardware take the layout of Stellaria's dashboard, and the look you know is still one click away.",
    chapter: "themes",
    hue: "#00c26a",
  },
  {
    title: "Status and quick settings",
    text: "Status shows the network, the volume and the battery as one button on Crest's taskbar. A click opens a quick panel with Wi-Fi and Bluetooth, each with a page of its own, the volume and its output, the brightness, Energy saver and Airplane mode.",
    chapter: "yours",
    hue: "#ffb511",
    demo: false,
  },
  {
    title: "Settings in a window of their own",
    text: "Crest's settings open in their own window, kept in step with the notch. Under Material, contour lines drift behind its pages (Animated background turns them off), and resting the pointer on a theme's card shows the window in that theme.",
    chapter: "yours",
    hue: "#ff48b0",
    demo: false,
  },
  {
    title: "Focus mode is back",
    text: "In Settings, Display, the switch Focus mode with three clicks is off by default. Turned on, it lets three quick clicks on the notch put it aside, half transparent or as a thin line, while clicks pass through to the app below. Three more bring it back.",
    chapter: "yours",
    hue: "#ff7c2f",
    demo: false,
  },
  {
    title: "Both limits in each quota ring",
    text: "Each AI quota ring shows the weekly (or other longer) limit outside and the 5-hour session in a thinner ring inside, so the session no longer hides behind the weekly number.",
    chapter: "ai",
    hue: "#c069ff",
    demo: false,
  },
  {
    title: "Status alerts everywhere",
    text: "Volume, brightness, the lock keys and the microphone can show over full-screen apps too, with Show everywhere, off by default. With Glass on they come as glass (Windows 11 24H2 or later on x64, not in the Microsoft Store version for now), and new alerts cover Copy, the output device, Do not disturb, Energy saver, airplane mode and monitors.",
    chapter: "closed",
    hue: "#ff5c87",
    demo: false,
  },
];

export const FIXES = [
  "The notch no longer stays open when you switch tools while typing on WebKit, which is mostly the Mac.",
  "A picture copied twice shows once in the clipboard history.",
  "The notch's window, its hit zone and the screen copy behind its glass follow Windows' Text size, and the detached timer grows with it and stays on its monitor.",
  "With Hide the Windows indicator on, Windows' own volume slider stays hidden even when another app registers a window of the taskbar's kind.",
];
