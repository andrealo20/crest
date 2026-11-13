/**
 * What the latest release brings, for the home page and What's new. Each item points at the chapter of the home page whose demo
 * shows it. The full list of every version comes from src/changelog.json, the one the app shows.
 */
export const RELEASE = "1.2";

/** `demo: false`: the browser demo cannot show it, so the card only leads to the chapter. */
export const HIGHLIGHTS: { title: string; text: string; chapter: string; hue: string; demo?: false }[] = [
  {
    title: "Liquid Glass",
    text: "Settings, Themes, Glass turns the open panel into glass on Windows. The screen behind it shows through, bent along the sides and blurred in the middle, and four sliders set how clear, how bent, how frosted and how bright at the rim it is.",
    chapter: "yours",
    hue: "#9d7aff",
    demo: false,
  },
  {
    title: "Glass on the closed notch",
    text: "A switch of its own makes the closed notch and the capsule glass too, over a live copy of the screen just around them. It needs Windows 11 24H2 or later, and while it is on the notch stays out of screenshots and screen sharing.",
    chapter: "yours",
    hue: "#4fa8ff",
    demo: false,
  },
  {
    title: "A tool bar that follows the pointer",
    text: "The highlight in the tool bar slides to the tool you point at, grows under it, squashes on a click and bounces back. Point at the notch on this page to try it.",
    chapter: "overview",
    hue: "#ff48b0",
  },
  {
    title: "Themes at sunrise and sunset",
    text: "Day and night can change with the sun at the place set for the Weather. Crest works the two times out on your computer, with no request to any service.",
    chapter: "yours",
    hue: "#ffb511",
    demo: false,
  },
  {
    title: "The date beside the clock",
    text: "The clock in the closed notch can show the date too, with a switch under the Clock part in Settings, Display.",
    chapter: "yours",
    hue: "#00c26a",
    demo: false,
  },
  {
    title: "A notice opens its app",
    text: "A click on a Windows notice in the closed notch opens the app it came from right away.",
    chapter: "extras",
    hue: "#ff7c2f",
    demo: false,
  },
  {
    title: "Play and skip from Overview",
    text: "The song in Overview has play, pause and next beside it.",
    chapter: "overview",
    hue: "#c069ff",
  },
  {
    title: "Lyrics through the pauses",
    text: "A synced lyric line stays in the closed notch through pauses shorter than 10 seconds, so the notch no longer shrinks and grows between lines.",
    chapter: "music",
    hue: "#ff5c87",
  },
];

export const FIXES = [
  "A favourite's tooltip in Edge or Chrome no longer stays on screen while Crest is open.",
  "The red privacy dot lights while Snipping Tool records the screen.",
  "With the capsule as the closed look, notices open as the capsule, also when a window rule turns it into the line.",
  "Crest looks for updates every 4 hours instead of once a day.",
];
