import { createStore } from "../../lib/store";
import { barParts } from "../../notch/row/visibility";
import { screenTime, type ScreenDay } from "../../platform/services";
import { settings, updateSettings } from "../../settings/store";
import { freshRounds, roundsOf } from "../timer/rounds";
import { focusLog } from "../timer/store";
import { dateKey } from "./model";

/*
 * Screen Time in the notch: the switch sent to Rust, and today's record for the closed row's parts and the bar's widgets, read once a
 * minute only while one of them shows it and it records (as the calendar store reads for its part and widget).
 */

/** Today's Screen Time, while a part or a widget shows it and it records; null otherwise. */
export const screenToday = createStore<ScreenDay | null>(null);

const POLL_MS = 60_000;
let timer: number | undefined;
let sent: boolean | null = null;

/** It records, and a part of the closed row or a widget of the bar draws it. */
function wanted(): boolean {
  const s = settings.get(), bar = barParts.get();
  return s.screenTime.on && (s.closed.parts.screentime || s.closed.parts.timeline || bar.includes("screentime") || bar.includes("timeline"));
}

function read() {
  const today = dateKey(Date.now());
  void screenTime.days(today, today).then(
    // A day with nothing yet is a day of 0 min, not Screen Time turned off.
    (days) => wanted() && screenToday.set(days[0] ?? { date: today, apps: {} }),
    () => {},
  );
}

function apply() {
  const on = settings.get().screenTime.on;
  if (on !== sent) {
    // At start too while off: Rust then deletes the days past 30.
    sent = on;
    void screenTime.set(on).catch(() => {});
  }
  if (!wanted()) {
    window.clearInterval(timer);
    timer = undefined;
    if (screenToday.get()) screenToday.set(null);
  } else if (timer === undefined) {
    read();
    timer = window.setInterval(read, POLL_MS);
  }
}

let pruned = "";

/**
 * At start and at each new local day (checked every hour): the focus rounds past 30 days go, as a timeline taken off logs no new round
 * that would drop them, and the switch goes to Rust again, which deletes the days past 30 also while it does not record.
 */
function prune() {
  const today = dateKey(Date.now());
  if (today === pruned) return;
  if (pruned) void screenTime.set(settings.get().screenTime.on).catch(() => {});
  pruned = today;
  const rounds = roundsOf(focusLog.get()), fresh = freshRounds(rounds, Date.now());
  if (fresh.length !== rounds.length) focusLog.set(fresh);
}

/** In the notch (main.tsx): sends the switch now and at each change, and reads today while it is drawn. */
export function startScreenTime() {
  prune();
  window.setInterval(prune, 3_600_000);
  apply();
  settings.subscribe(apply);
  barParts.subscribe(apply);
}

/**
 * The user's switch, in the settings or on the tool's page: on is the consent to record, and it also shows the tool, so the part and
 * the widget have a page to open on a Mac and in the Store build too (as Live notices turn Notices on).
 */
export function setScreenTime(on: boolean) {
  updateSettings((cur) => ({
    screenTime: { on },
    tools: on ? cur.tools.map((t) => (t.id === "screentime" ? { ...t, enabled: true } : t)) : cur.tools,
  }));
}
