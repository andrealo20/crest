import { createStore } from "../../lib/store";
import type { Reading } from "../../notch/row/parts/Readings";
import type { DiscordCall, DownloadProgress, UsageId } from "../../platform/services";
import { calendar } from "../calendar/store";
import { discordState } from "../discord/store";
import { github } from "../github/store";
import { leetcode } from "../leetcode/store";
import type { ScriptPart } from "../notices/scriptParts";
import { history } from "../notices/store";
import { awake } from "../overview/store";
import { privacy, snoozed } from "../privacy/store";
import { system } from "../system/store";
import { focusMuted, ringing } from "../timer/store";
import { usage } from "../usage/store";
import type { Forecast } from "../weather/store";
import type { DiskDrive } from "./disks";

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
};

export const barFeed = createStore<BarFeed>(EMPTY_FEED);

/** True while a bar's panel shows a tool; the notch sets it from barPanels.ts (feed.tsx). */
export const panelOpen = createStore(false);

/** The notices in Crest's list (notices/store.ts history), which the bar's clock opens: null while Live notices is off. */
export const noticeCount = createStore<number | null>(null);

/** `privacy` too, for the bar's privacy button, and the count: each changes only when Windows' state does. */
export const feedStores = { barFeed, privacy, noticeCount };

/** Sent only while `panelOpen`: `system` changes every few seconds and would wake the bar with nobody looking. */
export const panelStores = { calendar, github, leetcode, usage, discordState, system, history, awake, ringing, focusMuted, snoozed };
