import { createStore } from "../../lib/store";
import type { Reading } from "../../notch/row/parts/Readings";
import type { PowerState } from "../../notch/row/status";
import type { DiscordCall, DownloadProgress, UsageId } from "../../platform/services";
import { calendar } from "../calendar/store";
import { discordState } from "../discord/store";
import { github } from "../github/store";
import { hotkeysResting, shortcutResult } from "../launcher/store";
import { leetcode } from "../leetcode/store";
import type { ScriptPart } from "../notices/scriptParts";
import type { Market } from "./markets";
import { history } from "../notices/store";
import { awake } from "../overview/store";
import { privacy, snoozed } from "../privacy/store";
import { system } from "../system/store";
import { NO_FANS, type Fans } from "../system/thermals";
import { focusMuted, ringing } from "../timer/store";
import { usage } from "../usage/store";
import type { Forecast } from "../weather/store";
import type { DiskDrive } from "./disks";
import type { BtDevice } from "./quickPages";
import type { TopApp } from "./systemWidgets";
import type { UnreadApp } from "./unread";

/*
 * What the notch sends Crest's bar over the bridge (src/lib/bridge.ts), read by both windows: the widgets' data, computed in the
 * notch (feed.tsx) and ready to draw, and the stores the panel's tools show.
 */

/** One slice per widget, as the closed row draws it: empty until the widget's source first runs, then its last value while the source does not (feed.tsx). */
export interface BarFeed {
  weather: Forecast["current"] | null;
  /** The next 3 hours (weather/hours.ts nextHours), sent only while the weather's version is "hours": the bar wakes for nothing else. */
  weatherHours: { time: string; temp: number; code: number; day: boolean }[];
  title: { text: string; lyric: boolean } | null;
  playing: boolean;
  rings: { id: UsageId; value: number; inner?: number | null; label: string }[];
  readings: Reading[];
  /** CPU % over the last 30 s, one a second, sent only while the hardware's version is "line"; null for a gap, since the feed crosses the windows as JSON and NaN arrives as null. */
  spark: (number | null)[];
  github: { count: number; level: number } | null;
  leetcode: { count: number; level: number } | null;
  next: { text: string; color: string } | null;
  downloads: DownloadProgress[];
  call: DiscordCall | null;
  script: ScriptPart[];
  /** The drives, read every few minutes (feed.tsx DiskSource). */
  disks: DiskDrive[];
  /** Download and upload in bytes/s over the last 30 s, one a second, sent only while the hardware's version is "net"; null for a gap. */
  netSpark: { down: (number | null)[]; up: (number | null)[] };
  /** The three busiest apps for the Top apps widget, busiest first (systemWidgets.ts topApp); fewer while fewer are known. */
  topApps: TopApp[];
  /** The power state as Windows last told the notch (status/store.ts powerState), for the battery widget. */
  power: PowerState | null;
  /** Today and the next 3 days with the place's UTC offset, sent only while the weather's version is "details", "forecast" or "sun". */
  weatherDays: Pick<Forecast, "daily" | "offset"> | null;
  /** The Converter's pair and one unit's rate, read hourly (marketSources.tsx). */
  currency: { from: string; to: string; rate: number } | null;
  /** The crypto widget's coin, stock or portfolio as its version reads it (marketSources.tsx); see Market. */
  crypto: Market | null;
  /** Today's Screen Time: the total and the first three apps in seconds, and the seconds per hour, 24 of them; null while it does not record. */
  screenTime: { total: number; apps: { key: string; name: string; path: string | null; secs: number }[]; hours: number[] } | null;
  /** The Day timeline's timed events from midnight to tomorrow noon, without titles, and Screen Time per hour while it records. */
  timeline: { events: { start: number; end: number; color: string }[]; hours: number[] | null };
  /** The picked apps with their notifications still in Windows' notification centre, in the order picked; null until Windows is read. */
  unread: UnreadApp[] | null;
  /** The connected Bluetooth devices that report a battery, at most four, the lowest first: never the other paired devices' names. */
  btDevices: BtDevice[];
  /** The CPU's and the GPU's temperature now and over the last 10 minutes (thermals.ts), or the fans, as the widget's version draws. */
  temps: { cpu: number | null; gpu: number | null; cpuLine: (number | null)[]; gpuLine: (number | null)[]; fans: Fans };
}

export const EMPTY_FEED: BarFeed = {
  weather: null,
  weatherHours: [],
  title: null,
  playing: false,
  rings: [],
  readings: [],
  spark: [],
  github: null,
  leetcode: null,
  next: null,
  downloads: [],
  call: null,
  script: [],
  disks: [],
  netSpark: { down: [], up: [] },
  topApps: [],
  power: null,
  weatherDays: null,
  currency: null,
  crypto: null,
  screenTime: null,
  timeline: { events: [], hours: null },
  unread: null,
  btDevices: [],
  temps: { cpu: null, gpu: null, cpuLine: [], gpuLine: [], fans: NO_FANS },
};

export const barFeed = createStore<BarFeed>(EMPTY_FEED);

/** True while a bar's panel shows a tool; the notch sets it from barPanels.ts (feed.tsx). */
export const panelOpen = createStore(false);

/** The notices in Crest's list (notices/store.ts history), which the bar's clock opens: null while Live notices is off. */
export const noticeCount = createStore<number | null>(null);

/**
 * `privacy` too, for the bar's privacy button, the clock's count, the Launcher's Alt+N state (taken keys, resting in a game) for its
 * panel, and Keep awake for its widget: all change rarely, privacy with Windows' state, the count with Crest's notices, Alt+N with a
 * full-screen app and Keep awake when it is turned on or off or runs out.
 */
export const feedStores = { barFeed, privacy, noticeCount, shortcutResult, hotkeysResting, awake };

/** Sent only while `panelOpen`: `system` changes every few seconds and would wake the bar with nobody looking. */
export const panelStores = { calendar, github, leetcode, usage, discordState, system, history, ringing, focusMuted, snoozed };
