import { useEffect, type ReactNode } from "react";
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
import { ringLabel, ringProviders, ringValue } from "../../notch/row/parts/Rings";
import { useWeatherNow } from "../../notch/row/parts/WeatherPart";
import { barParts } from "../../notch/row/visibility";
import { subscribeLevels } from "../../platform/audio";
import { useNowPlaying } from "../../platform/media";
import { isMac, isNative } from "../../platform/native";
import { build, taskbar } from "../../platform/services";
import { settings } from "../../settings/store";
import { useDiscordCall } from "../discord/store";
import { downloads } from "../downloads/store";
import { useGithubViewer } from "../github/store";
import { useLeetcodeViewer } from "../leetcode/store";
import { scriptParts } from "../notices/store";
import { RELEASE_CAPTURE_MS } from "../now-playing/Equalizer";
import { useLyricLine } from "../now-playing/lyrics";
import { usage, useUsageViewer } from "../usage/store";
import { anyBarTool, barPanels, onBarShows } from "./barPanels";
import { barFeed, feedStores, panelOpen, panelStores, type BarFeed } from "./barStores";
import { barPartsFor, barSources, barWidgets } from "./widgets";

/*
 * The notch's end of the bar's widgets: it runs the closed row's hooks for each widget on the bar and sends the result to the
 * bar's window, which only draws (barStores.ts lists what goes over).
 */

/** In the notch: whether Crest's bar shows. Starts shown, so a notch that reloads does not leave the widgets without data. */
export const barOnScreen = createStore(true);
/** In the notch: a bar's panel shows Now Playing (barPanels.ts), whose equalizer only listens to the levels the notch captures. */
const barMedia = createStore(false);

/** The Windows app only: shares the widgets' data with the bar from its hello on, the panel's stores while the panel shows a tool, and follows whether the bar shows. */
export function startBarShare() {
  if (!isNative || isMac) return;
  // The panel's raw stores go to the bar only while a tool shows there.
  barPanels.subscribe(() => panelOpen.set(anyBarTool()));
  onBarShows("media", (on) => barMedia.set(on));
  shareStores(tauriTransport, feedStores, { to: "taskbar", hello: "bar://hello" });
  shareStores(tauriTransport, panelStores, { to: "taskbar", hello: "bar://hello", when: panelOpen });
  taskbar.onShown((on) => barOnScreen.set(on));
  // The Store build never builds the bar, whatever a restored backup says (bar.rs), so no shown state ever comes: no sources.
  void build.info().then((b) => { if (b.store) barOnScreen.set(false); }, () => {});
}

/** Writes a widget's slice only when it changed: each write goes to the bar. */
function useSlice<K extends keyof BarFeed>(key: K, value: BarFeed[K]) {
  const json = JSON.stringify(value);
  useEffect(() => {
    if (JSON.stringify(barFeed.get()[key]) !== json) barFeed.set((f) => ({ ...f, [key]: value }));
  }, [key, json]);
}

function WeatherSource() {
  useSlice("weather", useWeatherNow(true));
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

/** Keeps the capture on for the bar's equalizers (the widget's, Now Playing's in a panel), which only listen: while playing and a moment after, never with reduced motion. */
function EqualizerSource() {
  const np = useNowPlaying();
  const still = useReducedMotion();
  const capture = useHeld(!!np?.isPlaying, RELEASE_CAPTURE_MS) && !still;
  useEffect(() => (capture ? subscribeLevels(() => {}) : undefined), [capture]);
  useSlice("playing", !!np?.isPlaying);
  return null;
}

function RingsSource() {
  useUsageViewer();
  useSlice("rings", ringProviders(usage.use().providers).map((p) => ({ id: p.id, value: ringValue(p), label: ringLabel(p) })));
  return null;
}

function ReadingsSource() {
  const closed = settings.use().closed;
  // The part forced on: the bar shows readings with the notch's part off. No gaming: the bar hides over full-screen apps.
  useSlice("readings", useReadings({ ...closed, parts: { ...closed.parts, readings: true } }, false));
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
};

/**
 * Hidden, beside the notch: while the bar is on and shows, one child per widget on it runs that part's source and writes its
 * slice of `barFeed`. Mounting a child starts the source, unmounting stops it; the slices keep their last value meanwhile.
 */
export function WidgetSources(): ReactNode {
  language.use();
  const { enabled, zones } = settings.use().taskbar;
  const shown = barOnScreen.use();
  const parts = barPartsFor(barWidgets(zones), enabled, shown);
  const key = parts.join();
  useEffect(() => barParts.set(parts), [key]);
  useEffect(() => () => barParts.set([]), []);
  // A child only once its store has been told: these effects run after the children's, and a source mounted with the change would
  // write the slice of a store not yet running (the calendar's null, its widget blinking to its icon).
  const told = barParts.use();
  const media = barMedia.use();
  return barSources(shown ? told : [], media).map((id) => {
    const Source = SOURCES[id];
    return Source && <Source key={id} />;
  });
}
