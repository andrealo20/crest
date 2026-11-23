import { useEffect, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { language } from "../../i18n";
import { shareStores } from "../../lib/bridge";
import { createStore } from "../../lib/store";
import { tauriTransport } from "../../lib/tauriTransport";
import { useHeld } from "../../notch/row/CompactRow";
import { trackCaption, type PartId } from "../../notch/row/parts";
import { useGithubToday } from "../../notch/row/parts/GithubPart";
import { useLeetcodeToday } from "../../notch/row/parts/LeetcodePart";
import { useNextEvent } from "../../notch/row/parts/NextEventPart";
import { useReadings } from "../../notch/row/parts/Readings";
import { ringProps, ringProviders } from "../../notch/row/parts/Rings";
import { barParts } from "../../notch/row/visibility";
import { holdLevels } from "../../platform/audio";
import { useNowPlaying } from "../../platform/media";
import { isMac, isNative } from "../../platform/native";
import { build, taskbar } from "../../platform/services";
import { settings } from "../../settings/store";
import { useDiscordCall } from "../discord/store";
import { downloads } from "../downloads/store";
import { useGithubViewer } from "../github/store";
import { useLeetcodeViewer } from "../leetcode/store";
import { history, scriptParts } from "../notices/store";
import { RELEASE_CAPTURE_MS } from "../now-playing/Equalizer";
import { useLyricLine } from "../now-playing/lyrics";
import { system } from "../system/store";
import { usage, useUsageViewer } from "../usage/store";
import { nextHours } from "../weather/hours";
import { isStale } from "../weather/stale";
import { useForecast } from "../weather/store";
import { anyBarTool, barPanels, onBarShows } from "./barPanels";
import { barFeed, feedStores, noticeCount, panelOpen, panelStores, type BarFeed } from "./barStores";
import { variantOf } from "./model";
import { SLIDE_KEEP_MS, barPartsFor, barSources, barWidgets, sourcesAfter, type BarSeen } from "./widgets";

/*
 * The notch's end of the bar's widgets: it runs the closed row's hooks for each widget on the bar and sends the result to the
 * bar's window, which only draws (barStores.ts lists what goes over).
 */

/**
 * In the notch: whether the bar's widget sources run: while the primary bar shows, and for SLIDE_KEEP_MS after it starts sliding away
 * (widgets.ts sourcesAfter). Starts on, so a notch that reloads does not leave the widgets without data.
 */
export const sourcesOn = createStore(true);
/** In the notch: a bar's panel shows Now Playing (barPanels.ts), whose equalizer only listens to the levels the notch captures. */
const barMedia = createStore(false);
/** In the notch: the Store build, which never builds the bar, so the bar counts as off and not even Discord stays connected for it. */
const noBar = createStore(false);

/** The Windows app only: shares the widgets' data with the bar from its hello on, the panel's stores while the panel shows a tool, and follows whether the bar shows. */
export function startBarShare() {
  if (!isNative || isMac) return;
  // The panel's raw stores go to the bar only while a tool shows there.
  barPanels.subscribe(() => panelOpen.set(anyBarTool()));
  onBarShows("media", (on) => barMedia.set(on));
  // The clock's count is the list its panel opens on, Crest's notices, and nothing while Live notices is off. Written only on a change:
  // each write goes to the bar, and the settings change for much else.
  const count = () => {
    const n = settings.get().notices.enabled ? history.get().length : null;
    if (n !== noticeCount.get()) noticeCount.set(n);
  };
  count();
  history.subscribe(count);
  settings.subscribe(count);
  shareStores(tauriTransport, feedStores, { to: "taskbar", hello: "bar://hello" });
  shareStores(tauriTransport, panelStores, { to: "taskbar", hello: "bar://hello", when: panelOpen });
  // Rust tells the primary bar's window and its slide apart (bar.rs `tell_notch`): a slide keeps the sources SLIDE_KEEP_MS, a hide stops
  // them at once. One wait at a time, cleared by the next change.
  let seen: BarSeen = { shown: true, slid: false };
  let wait = 0;
  taskbar.onBarSeen((now) => {
    const next = sourcesAfter(seen, now);
    seen = now;
    if (next === null) return;
    window.clearTimeout(wait);
    if (next === "keep") wait = window.setTimeout(() => sourcesOn.set(false), SLIDE_KEEP_MS);
    sourcesOn.set(next !== "rest");
  });
  // The Store build never builds the bar, whatever a restored backup says (bar.rs), so no shown state ever comes: no sources.
  void build.info().then((b) => { if (b.store) { sourcesOn.set(false); noBar.set(true); } }, () => {});
}

/** Writes a widget's slice only when it changed: each write goes to the bar. */
function useSlice<K extends keyof BarFeed>(key: K, value: BarFeed[K]) {
  const json = JSON.stringify(value);
  useEffect(() => {
    if (JSON.stringify(barFeed.get()[key]) !== json) barFeed.set((f) => ({ ...f, [key]: value }));
  }, [key, json]);
}

function WeatherSource() {
  const f = useForecast(15 * 60_000, true);
  const hours = variantOf(settings.use().taskbar.variants, "weather") === "hours";
  const ok = f && f !== "error" && !isStale(f.savedAt, Date.now()) ? f : null;
  // As useWeatherNow: none from a saved forecast hours old.
  useSlice("weather", ok ? ok.current : null);
  // Read again with each forecast refresh, 15 min at most, so just after the hour the face may still show the hour that has begun: accepted.
  useSlice("weatherHours", ok && hours ? nextHours(ok.hourly, ok.offset, Date.now()).map(({ time, temp, code, day }) => ({ time, temp, code, day })) : []);
  return null;
}

function TitleSource() {
  const music = settings.use().music;
  const np = useNowPlaying();
  const line = useLyricLine(np, music.titleLyrics, { roman: music.closedRoman === true, translation: music.closedTranslation === true });
  // As in the closed row: the sung line while the song plays, else title and artist.
  const lyric = !!(music.titleLyrics && np?.isPlaying && line);
  const text = lyric ? line : np ? trackCaption(np.title ?? "", np.artist ?? "") : "";
  useSlice("title", text ? { text, lyric } : null);
  useSlice("playing", !!np?.isPlaying);
  return null;
}

/** Keeps the capture on for the bar's equalizers (the widget's, Now Playing's in a panel), which only listen: while playing and a moment after, never with reduced motion. The notch does not listen for them. */
function EqualizerSource() {
  const np = useNowPlaying();
  const still = useReducedMotion();
  const capture = useHeld(!!np?.isPlaying, RELEASE_CAPTURE_MS) && !still;
  useEffect(() => (capture ? holdLevels() : undefined), [capture]);
  useSlice("playing", !!np?.isPlaying);
  return null;
}

function RingsSource() {
  useUsageViewer();
  useSlice("rings", ringProviders(usage.use().providers).map((p) => ({ id: p.id, ...ringProps(p) })));
  return null;
}

function ReadingsSource() {
  const closed = settings.use().closed;
  // The part forced on: the bar shows readings with the notch's part off. No gaming: the bar hides over full-screen apps.
  useSlice("readings", useReadings({ ...closed, parts: { ...closed.parts, readings: true } }, false));
  const line = variantOf(settings.use().taskbar.variants, "readings") === "line";
  const cpu = system.use().history.cpu;
  // The history is filled linearly once a second when only the bar asks, every 2 to 3 s (design 2D); gaps go as null, since NaN crosses the bridge as JSON null.
  useSlice("spark", line ? cpu.slice(-30).map((v) => (Number.isNaN(v) ? null : Math.round(v))) : []);
  return null;
}

function CalendarSource() {
  const next = useNextEvent();
  useSlice("next", next && { text: next.text, color: next.color });
  return null;
}

function DownloadsSource() {
  useSlice("downloads", downloads.use());
  return null;
}

function DiscordSource() {
  useSlice("call", useDiscordCall());
  return null;
}

function GithubSource() {
  useGithubViewer();
  useSlice("github", useGithubToday());
  return null;
}

function LeetcodeSource() {
  useLeetcodeViewer();
  useSlice("leetcode", useLeetcodeToday());
  return null;
}

function ScriptSource() {
  useSlice("script", scriptParts.use());
  return null;
}

/** How often the disk widget's drives are read: never a tight poll, so an idle disk is not kept awake. */
const DISKS_EVERY = 5 * 60_000;

/** The drives now and every DISKS_EVERY; Crest hears no device change, so a drive plugged in shows on the next read (or in the panel, which reads as it opens). */
function DiskSource() {
  const [list, setList] = useState(() => barFeed.get().disks);
  useEffect(() => {
    let on = true;
    const read = () => void taskbar.disks().then((d) => on && d && setList(d));
    read();
    const id = window.setInterval(read, DISKS_EVERY);
    return () => {
      on = false;
      window.clearInterval(id);
    };
  }, []);
  useSlice("disks", list);
  return null;
}

/** The clock and the timer have none: the bar counts the time itself, and the timer is a saved store. */
const SOURCES: Partial<Record<PartId, () => null>> = {
  weather: WeatherSource,
  title: TitleSource,
  equalizer: EqualizerSource,
  rings: RingsSource,
  readings: ReadingsSource,
  calendar: CalendarSource,
  downloads: DownloadsSource,
  discord: DiscordSource,
  github: GithubSource,
  leetcode: LeetcodeSource,
  script: ScriptSource,
  disk: DiskSource,
};

/**
 * Hidden, beside the notch: while the bar is on and its sources run (sourcesOn), one child per widget on it runs that part's source and writes its
 * slice of `barFeed`. Mounting a child starts the source, unmounting stops it; the slices keep their last value meanwhile.
 */
export function WidgetSources(): ReactNode {
  language.use();
  const { enabled, zones } = settings.use().taskbar;
  const live = sourcesOn.use();
  const none = noBar.use();
  const parts = barPartsFor(barWidgets(zones), enabled && !none, live);
  const key = parts.join();
  useEffect(() => barParts.set(parts), [key]);
  useEffect(() => () => barParts.set([]), []);
  // A child only once its store has been told: these effects run after the children's, and a source mounted with the change would
  // write the slice of a store not yet running (the calendar's null, its widget blinking to its icon).
  const told = barParts.use();
  const media = barMedia.use();
  return barSources(live ? told : [], media).map((id) => {
    const Source = SOURCES[id];
    return Source && <Source key={id} />;
  });
}
