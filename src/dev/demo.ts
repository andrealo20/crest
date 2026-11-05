import { sampleAvatar } from "./showcase-data";
import { demoOpen } from "../platform/native";
import { media } from "../platform/media";
import { mockAsk, mockDiscord, mockDownload, mockNotice, mockPrivacy, mockStatus, demoOffer, secrets } from "../platform/services";
import { settings, updateSettings, type Settings } from "../settings/store";
import { nav, navigate } from "../notch/nav";
import { pinned } from "../notch/useNotchState";
import { findTab, pageTabs, tabs, type NotchTab } from "../notch/tabs";
import { isLanguage, type Language } from "../i18n/core";
import { language, t } from "../i18n";
import { plugins, setPluginEnabled } from "../features/plugins/store";
import { answerAsk, asks, dismissPop, history } from "../features/notices/store";
import { dismissDownload } from "../features/downloads/store";
import { saved } from "../features/capture/store";
import { dueTasks } from "../features/todos/store";
import { statusAlert } from "../features/status/store";
import { BUILT_IN_THEMES } from "../features/themes/themes";
import { timer, timerActions } from "../features/timer/store";
import { todoActions } from "../features/todos/store";
import { waterDue } from "../features/water/store";
import { calendar, calendarDue } from "../features/calendar/store";
import { usage } from "../features/usage/store";
import { recording, startRecording, stopRecording, takeShot } from "../features/capture/store";
import { checkForUpdate, update } from "../lib/update";

/*
 * The try-it demo of the project page (Crest's real frontend, built for the web: `vite build --mode demo`, or `?demo`).
 * Browser only; nothing here runs in the app, and nothing leaves the page: every request the tools would make is
 * answered from sample data (src/dev/demo-data.ts and the mocks in src/platform).
 *
 * Contract with the host page (all messages carry `crest: "demo"`):
 *
 * URL: ?tool=<id> opens on a tool, ?lang=<code> (default en), ?bare drops the fake desktop (transparent page), ?open starts open.
 *
 * Host -> demo (postMessage on the iframe's window):
 *   { cmd: "navigate", tool }   open the notch on a tool (a tool id, or settings | setup | whatsnew | find)
 *   { cmd: "open" } { cmd: "close" }
 *   { cmd: "notice", kind }     timer ask download capture status-unplug status-bt volume brightness capslock call todo
 *                               water calendar quota live song whatsnew recording
 *   { cmd: "play" } { cmd: "pause" }
 *   { cmd: "lang", code } { cmd: "style", style: notch | capsule | line } { cmd: "edge", edge: top | bottom | left | right }
 *   { cmd: "theme", id } { cmd: "pet", on }
 *
 * Demo -> host (postMessage on the parent):
 *   { event: "ready", tools: [{ id, label, hue }] }   the tools in the dock (sent again when the language changes)
 *   { event: "tool", tool }    the visible tool changed
 *   { event: "open", open }    the notch opened or closed
 *   { event: "size", w, h }    the notch's outer size in CSS px (follows its spring)
 */

const params = new URLSearchParams(location.search);

/** The dock, in an order that shows the best first. Every tool is on, the Windows-only ones included. */
const DEMO_TOOLS = [
  "overview", "media", "timer", "todos", "notes", "clipboard", "shelf", "ask", "convert", "weather", "usage", "trading", "system",
  "calendar", "github", "discord", "notices", "capture", "recorder", "camera", "launcher", "vault", "terminal", "water", "scratchpad",
];

/** A finger has no hover: the notch opens on a tap, and an open one stays until a tap outside. */
const coarse = matchMedia("(pointer: coarse)").matches;

const post = (msg: Record<string, unknown>) => {
  if (window.parent !== window) window.parent.postMessage({ crest: "demo", ...msg }, "*");
};

const pick = <T>(list: T[], i: number): T => list[i % list.length];

export function startDemo() {
  const lang: Language = isLanguage(params.get("lang")) ? (params.get("lang") as Language) : "en";

  updateSettings((s): Partial<Settings> => ({
    lang,
    openMode: coarse ? "click" : "hover",
    hoverDelay: "normal",
    setup: { done: true },
    tools: [...DEMO_TOOLS.map((id) => ({ id, enabled: true })), ...s.tools.filter((x) => !DEMO_TOOLS.includes(x.id)).map((x) => ({ ...x, enabled: x.id.startsWith("plugin:") }))],
    trading: { env: "live", base: "EUR" },
    weather: { name: "Amsterdam", lat: 52.37, lon: 4.89, auto: false },
    ask: { provider: "anthropic", configs: { ...s.ask.configs, anthropic: { model: "claude-opus-5-5", effort: "high", baseUrl: "" } } },
    usage: { ...s.usage, cursor: true },
    github: { user: "andrealo20" },
    privacyDots: true,
    notices: { ...s.notices, enabled: true, windows: true, cli: true },
    calendar: {
      ...s.calendar,
      sources: [
        { id: "work", kind: "ics", name: "Work", color: "#419cff", url: "", user: "", host: "calendar.example.com" },
        { id: "home", kind: "ics", name: "Personal", color: "#30d158", url: "", user: "", host: "calendar.example.com" },
      ],
    },
    launcher: {
      ...s.launcher,
      favorites: ["Claude", "ChatGPT", "Cursor", "Spotify", "Terminal", "Notepad"].map((name) => ({ id: `shell:AppsFolder\\${name}`, name })),
    },
    music: { ...s.music, titleLyrics: true },
    closed: {
      ...s.closed,
      parts: { ...s.closed.parts, timer: true, discord: true, rings: true, title: true, readings: true, equalizer: true, clock: true, github: true, calendar: true, script: true, downloads: true, weather: false },
      readings: { ...s.closed.readings, cpu: true, ram: true, gpu: true },
    },
  }));
  // Keys the tools look for, so the portfolio shows its accounts.
  void secrets.set("t212.key", "demo");
  void secrets.set("kraken.key", "demo");
  // A focus timer already running, the way the closed row looks in use.
  timerActions.select("focus", 25 * 60);
  timerActions.start();
  seedNotices();
  navigate(params.get("tool") ?? "overview");

  // The sample plugin is installed (src/platform/services.ts); its tool is on once the list has been read.
  const offPlugins = plugins.subscribe(() => {
    if (!plugins.get().length) return;
    offPlugins();
    plugins.get().forEach((m) => setPluginEnabled(m.id, true));
  });

  // Touch has no hover, and Tailwind's group-hover never applies there: the buttons that appear on hover (copy, delete, show) stay visible.
  if (coarse) {
    const style = document.createElement("style");
    style.textContent = '[class*="group-hover:opacity-100"] { opacity: 1 !important; }';
    document.head.append(style);
  }

  window.addEventListener("message", onMessage);
  watchFrame();
  nav.subscribe(() => post({ event: "tool", tool: nav.get().tabId }));
  const ready = sendReadyOnChange();
  settings.subscribe(ready);
  language.subscribe(ready);
  plugins.subscribe(() => post({ event: "ready", tools: toolList() }));
  setTimeout(() => post({ event: "ready", tools: toolList() }), 0);
  if (params.has("open") || params.has("tool")) demoOpen(params.get("tool"));
}

/** What the page shows in its own list of tools. */
function toolList() {
  return settings
    .get()
    .tools.filter((x) => x.enabled)
    .map((x) => findTab(x.id))
    .filter((x): x is NotchTab => !!x)
    .map((x) => ({ id: x.id, label: t(x.label), hue: x.hue ?? null }));
}

/** The list of tools goes out again when the language or the set of tools changes. */
function sendReadyOnChange() {
  let last = "";
  return () => {
    const s = settings.get();
    const key = language.get() + s.tools.filter((x) => x.enabled).map((x) => x.id).join();
    if (key === last) return;
    last = key;
    post({ event: "ready", tools: toolList() });
  };
}

// ---------- Commands ----------

const STYLES = ["notch", "capsule", "line"] as const;
const EDGES = ["top", "bottom", "left", "right"] as const;

function onMessage(e: MessageEvent) {
  const m = e.data as { crest?: string; cmd?: string; [k: string]: unknown } | null;
  if (!m || m.crest !== "demo" || e.source !== window.parent) return;
  switch (m.cmd) {
    case "navigate": {
      const id = String(m.tool);
      if (![...tabs, ...pageTabs].some((x) => x.id === id) && !findTab(id)) return;
      // A tool the visitor switched off in the settings comes back for this.
      updateSettings((s) => ({ tools: s.tools.map((x) => (x.id === id ? { ...x, enabled: true } : x)) }));
      return demoOpen(id);
    }
    case "open":
      return demoOpen(null);
    case "close":
      return void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    case "notice":
      return notice(String(m.kind));
    case "play":
      return void (!media.get()?.isPlaying && media.toggle());
    case "pause":
      return void (media.get()?.isPlaying && media.toggle());
    case "lang":
      return void (isLanguage(m.code) && updateSettings({ lang: m.code as Language }));
    case "style":
      return void ((STYLES as readonly unknown[]).includes(m.style) && updateSettings((s) => ({ display: { ...s.display, idleStyle: m.style as (typeof STYLES)[number] } })));
    case "edge":
      return void ((EDGES as readonly unknown[]).includes(m.edge) && updateSettings((s) => ({ dock: { ...s.dock, edge: m.edge as (typeof EDGES)[number] } })));
    case "theme":
      return void (BUILT_IN_THEMES.some((x) => x.id === m.id) && updateSettings((s) => ({ themes: { ...s.themes, id: String(m.id) } })));
    case "pet":
      return void updateSettings((s) => ({ closed: { ...s.closed, pet: { ...s.closed.pet, id: m.on ? "cat" : null } } }));
  }
}

let step = 0;

/** One notice of each kind, as the app would show it. They go through the same stores as the real ones. */
function notice(kind: string) {
  step++;
  clearNotices(kind);
  switch (kind) {
    case "timer":
      return timer.set((s) => ({ ...s, endsAt: null, remaining: 0, finished: true }));
    case "ask":
      return void mockAsk({ title: "Run command?", body: "npm test", appName: "Agent" });
    case "download":
      return mockDownload(pick(["Crest-report.pdf", "holiday-photos.zip", "installer.exe"], step));
    case "capture":
      return void takeShot("all", null);
    case "status-unplug":
      return mockStatus.unplug();
    case "status-bt":
      return mockStatus.bluetooth();
    case "volume":
      return mockStatus.volume();
    case "brightness":
      return mockStatus.brightness();
    case "capslock":
      return mockStatus.capsLock();
    case "call":
      if (mockDiscord.get().call) return;
      mockPrivacy.mic = true;
      return mockDiscord.toggleCall();
    case "todo":
      return todoActions.add("Call the dentist", Date.now() - 1000);
    case "water":
      return waterDue.set(true);
    case "calendar": {
      const next = calendar.get().data?.events.find((x) => x.start > Date.now() && /meet/i.test(x.description)) ?? calendar.get().data?.events[0];
      if (next) calendarDue.set(next);
      return;
    }
    case "quota":
      return raiseQuota();
    case "live": {
      const from = [
        { appId: "app:mail", appName: "Mail", title: "Sam", body: "Lunch at 12:30? I booked the corner table.", icon: sampleAvatar("Mail", 2) },
        { appId: "app:chat", appName: "Messages", title: "Mira", body: "The build is green. Ship it!", icon: sampleAvatar("Messages", 1) },
        { appId: "app:cal", appName: "Calendar", title: "Dentist tomorrow", body: "8:15, Dr. Jansen", icon: sampleAvatar("Calendar", 3) },
      ];
      return mockNotice({ source: "windows", ...pick(from, step) });
    }
    case "song": {
      // The new-song notice only shows while the title part is off, so it is off for the few seconds it takes.
      const was = settings.get().closed.parts.title;
      updateSettings((s) => ({ closed: { ...s.closed, parts: { ...s.closed.parts, title: false } } }));
      if (!media.get()?.isPlaying) media.toggle();
      media.next();
      return void setTimeout(() => updateSettings((s) => ({ closed: { ...s.closed, parts: { ...s.closed.parts, title: was } } })), 6000);
    }
    case "whatsnew":
      demoOffer.on = true;
      update.set((s) => ({ ...s, phase: "idle" }));
      return void checkForUpdate();
    case "recording":
      return void (recording.get().phase === "idle" ? startRecording("monitor:primary", 30, false, true, true) : stopRecording());
  }
}

/** What an earlier notice left on screen (a finished timer or a question waits for a click) would hide the next one. */
function clearNotices(kind: string) {
  if (timer.get().finished) timerActions.dismiss();
  asks.get().forEach((a) => answerAsk(a.id, null));
  dueTasks.get().forEach((x) => todoActions.done(x.id));
  if (kind !== "recording" && recording.get().phase !== "idle") stopRecording();
  waterDue.set(false);
  calendarDue.set(null);
  demoOffer.on = false;
  update.set((s) => (s.phase === "available" ? { ...s, phase: "current", version: null } : s));
  dismissPop();
  dismissDownload();
  saved.set(null);
  statusAlert.set(null);
}

/** Each call pushes the next quota over a level; the next poll puts the readings back. */
function raiseQuota() {
  const targets: [string, string, number][] = [["claude", "session", 93], ["claude", "weekly", 76], ["codex", "weekly", 72]];
  const [id, kind, used] = pick(targets, step);
  usage.set((u) => ({
    ...u,
    updatedAt: Date.now(),
    providers: u.providers.map((p) => (p.id === id ? { ...p, windows: p.windows.map((w) => (w.kind === kind ? { ...w, usedPercent: used } : w)) } : p)),
  }));
}

/** A few earlier notifications on the Notices page, without popping up. */
function seedNotices() {
  const now = Date.now();
  const n = (i: number, appName: string, title: string, body: string, ago: number) => ({
    id: `demo-${i}`, source: "windows" as const, appId: `app:${appName.toLowerCase()}`, appName, title, body, icon: sampleAvatar(appName, i), at: now - ago * 60_000,
  });
  history.set([
    n(1, "Mail", "Sam", "Lunch at 12:30? I booked the corner table.", 4),
    n(2, "Messages", "Mira", "The build is green. Ship it!", 17),
    n(3, "Calendar", "Design review in 10 minutes", "Room 4", 52),
    n(4, "Photos", "Memories", "Your trip to Lisbon, two years ago", 140),
    { ...n(5, "crest-notify", "cargo test finished", "Exit code 0", 190), source: "cli" as const, exitCode: 0, durationMs: 41_000, command: "cargo test" },
  ]);
}

// ---------- What the host page hears ----------

/**
 * The notch opens and closes inside React; the page learns it from the DOM: the open panel is the only thing with a drag
 * header. The shape's size follows its spring, so it is passed on a few times a second and once more when it settles.
 */
function watchFrame() {
  let open = false;
  let shape: Element | null = null;
  let sent = { w: 0, h: 0 };
  let timer: number | undefined;
  const sendSize = () => {
    if (!shape) return;
    const r = shape.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    if (w === sent.w && h === sent.h) return;
    sent = { w, h };
    post({ event: "size", w, h });
  };
  const ro = new ResizeObserver(() => {
    if (timer === undefined) timer = window.setTimeout(() => ((timer = undefined), sendSize()), 80);
  });
  const scan = () => {
    const el = document.querySelector("[data-notch-shape]");
    if (el && el !== shape) {
      shape = el;
      ro.observe(el);
      sendSize();
    }
    const now = !!document.querySelector("[data-drag-handle]");
    if (now === open) return;
    open = now;
    post({ event: "open", open });
    // Touch: the notch stays open until a tap outside, since a lifted finger counts as leaving.
    if (open && coarse) pinned.set(true);
    post({ event: "tool", tool: nav.get().tabId });
  };
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
  // A tap outside the open notch closes it (a mouse leaves by itself).
  if (coarse) {
    window.addEventListener("pointerdown", (e) => {
      const target = e.target as Element;
      if (open && !target.closest?.("[data-notch-hit], [data-notch-menu]")) window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
  }
}
