import { askNotch } from "../../lib/tauriTransport";
import { isNotchWindow } from "../../lib/windowKind";
import { useEffect, useState } from "react";
import { createStore } from "../../lib/store";
import { playAlarm, stopAlarm } from "../../lib/sound";
import { settings } from "../../settings/store";
import { focusSoundFor, setFocusSound } from "./focusSound";
import { clampDuration, customsOf, remember } from "./duration";
import { STOPWATCH_IDLE, lapAt, toggleAt, type Stopwatch } from "./stopwatch";
import { logRound, roundsOf, roundsWanted, type FocusRound } from "./rounds";

export type TimerMode = "focus" | "break";

interface TimerState {
  mode: TimerMode;
  /** Total duration in seconds. */
  duration: number;
  /** End timestamp (Date.now()) while running. */
  endsAt: number | null;
  /** Remaining seconds while paused. */
  remaining: number;
  /** Finished: stays until the user dismisses it (timer view + live activity show it). */
  finished: boolean;
  /** Last custom duration started per mode (seconds), kept beside `recent` as a single number, which is what an older Crest reads. */
  custom?: Partial<Record<TimerMode, number>>;
  /** The last custom durations started per mode (seconds), newest first, each shown as its own chip. */
  recent?: Partial<Record<TimerMode, number[]>>;
}

export const presets: Record<TimerMode, number[]> = {
  focus: [15 * 60, 25 * 60, 45 * 60],
  break: [5 * 60, 10 * 60, 15 * 60],
};

/** The custom durations remembered for `mode`, newest first; a timer saved by an older Crest has its one `custom` number. */
export const remembered = (s: TimerState, mode: TimerMode) => customsOf(s.recent?.[mode] ?? s.custom?.[mode], presets[mode]);

const initial: TimerState = { mode: "focus", duration: 25 * 60, endsAt: null, remaining: 25 * 60, finished: false };

// Persisted: a running timer survives an app restart.
export const timer = createStore<TimerState>(initial, { persist: "timer" });

/** Is the alarm ringing right now? Not persisted, nothing rings after a restart. */
export const ringing = createStore(false);

/** Focus sound muted from the Timer tool until Crest restarts; the setting stays as it is. */
export const focusMuted = createStore(false);

/** The Timer tool's page in this window: the countdown or the stopwatch; not saved. */
export const timerTab = createStore<"timer" | "stopwatch">("timer");
// A timer that ends while the stopwatch shows brings its finished view (and its Stop alarm) back.
let wasFinished = timer.get().finished;
timer.subscribe(() => {
  const { finished } = timer.get();
  if (finished && !wasFinished) timerTab.set("timer");
  wasFinished = finished;
});

/** The stopwatch, saved as when it started rather than as a count: it keeps counting while Crest is closed, as the timer does, and every window shows the same one. */
export const stopwatch = createStore<Stopwatch>(STOPWATCH_IDLE, { persist: "stopwatch" });

/** The focus rounds finished in the last 30 days, for the Day timeline; written only while it or Screen Time is in use (rounds.ts roundsWanted). */
export const focusLog = createStore<FocusRound[]>([], { persist: "focus-rounds" });

/** Start or pause, a lap, and back to zero for the stopwatch. */
export const stopwatchActions = {
  toggle: () => stopwatch.set((s) => toggleAt(s, Date.now())),
  lap: () => stopwatch.set((s) => lapAt(s, Date.now())),
  reset: () => stopwatch.set(STOPWATCH_IDLE),
};

export function remainingOf(s: TimerState, now = Date.now()): number {
  if (s.endsAt === null) return s.remaining;
  return Math.max(0, (s.endsAt - now) / 1000);
}

export const timerActions = {
  /** Only stop the sound; "finished" stays visible. */
  silence() {
    stopAlarm();
    window.clearTimeout(ringTimeout);
    ringing.set(false);
  },
  /** Dismiss a finished timer: after focus a short break is prepared (not started). */
  dismiss() {
    timerActions.silence();
    timer.set((s) => {
      if (!s.finished) return s;
      const mode: TimerMode = s.mode === "focus" ? "break" : "focus";
      const duration = remembered(s, mode)[0] ?? (mode === "break" ? presets.break[0] : presets.focus[1]);
      return { ...s, mode, duration, remaining: duration, endsAt: null, finished: false };
    });
  },
  /** A custom duration is remembered here, when it is started, so typing or wheeling through others never pushes one out. */
  start() {
    timerActions.silence();
    timer.set((s) => {
      const own = !presets[s.mode].includes(s.duration);
      return {
        ...s,
        endsAt: Date.now() + s.remaining * 1000,
        finished: false,
        recent: { ...s.recent, [s.mode]: remember(remembered(s, s.mode), s.duration, presets[s.mode]) },
        custom: own ? { ...s.custom, [s.mode]: s.duration } : s.custom,
      };
    });
  },
  pause() {
    timer.set((s) => ({ ...s, remaining: remainingOf(s), endsAt: null }));
  },
  reset() {
    timer.set((s) => ({ ...s, remaining: s.duration, endsAt: null, finished: false }));
  },
  select(mode: TimerMode, duration: number) {
    timerActions.silence();
    timer.set((s) => ({ ...s, mode, duration, remaining: duration, endsAt: null, finished: false }));
  },
  /** Sets a duration in seconds, within the limits; it becomes a chip once it is started. */
  setDuration(seconds: number) {
    const duration = clampDuration(seconds);
    timer.set((s) => ({ ...s, duration, remaining: duration, endsAt: null, finished: false }));
  },
};

/**
 * The view's Stop alarm. Only the notch rings, and it stops by itself only once the shared timer is no longer finished, which Stop
 * keeps; so another window (the bar's panel) asks the notch.
 */
export function stopRinging() {
  if (!isNotchWindow) return askNotch({ kind: "timerSilence" });
  timerActions.silence();
}

/** The view's mute. The notch alone plays the focus sound and holds `focusMuted`, so another window asks the notch. */
export function setFocusMuted(on: boolean) {
  if (!isNotchWindow) return askNotch({ kind: "focusMute", on });
  focusMuted.set(on);
}

// Watch for the end (one place for the whole app): one timeout at `endsAt`, no
// polling while nothing runs.
/** An end older than this was missed (app closed, PC asleep): no alarm for it. */
const STALE_MS = 2 * 60_000;
let ringTimeout: number | undefined;
let endTimeout: number | undefined;
let scheduledFor: number | null = null;

function checkEnd() {
  const s = timer.get();
  if (s.endsAt !== null && remainingOf(s) <= 0) {
    timer.set((t) => ({ ...t, remaining: 0, endsAt: null, finished: true }));
    // Before the stale return: a round that ended while Crest was closed counts too. A round stopped before its end does not.
    if (s.mode === "focus" && roundsWanted(settings.get())) {
      const round = { end: s.endsAt, secs: s.duration };
      focusLog.set((l) => logRound(roundsOf(l), round, Date.now()));
    }
    // Ended while Crest was closed or the PC slept: finished, but no alarm at the next login (as with reminders).
    if (Date.now() - s.endsAt > STALE_MS) return;
    const { sound, volume, duration: ring } = settings.get().alarm;
    playAlarm(sound, volume, ring);
    ringing.set(true);
    window.clearTimeout(ringTimeout);
    // Same length as in playAlarm ("until stopped" = at most 2 min).
    ringTimeout = window.setTimeout(() => ringing.set(false), (ring === -1 ? 120 : Math.max(3, ring)) * 1000);
  }
}

function scheduleEnd() {
  const { endsAt } = timer.get();
  if (endsAt === scheduledFor) return;
  window.clearTimeout(endTimeout);
  scheduledFor = endsAt;
  if (endsAt === null) return;
  endTimeout = window.setTimeout(() => {
    scheduledFor = null;
    checkEnd();
    // Woke too early (clock change) or capped: try again.
    scheduleEnd();
    // At most a minute at a time, so a sleep cannot delay the end by its length.
  }, Math.min(60_000, Math.max(0, endsAt - Date.now())));
}
// The detached timer and the settings window show and control the timer, but only the notch window rings.
if (isNotchWindow) {
  timer.subscribe(scheduleEnd);
  scheduleEnd();
  // Dismissed or restarted from the detached window: stop the sound here too.
  timer.subscribe(() => {
    if (!timer.get().finished && ringing.get()) timerActions.silence();
  });
  // A timer still running from before Crest started stays silent until it is started again.
  const bootEndsAt = timer.get().endsAt;
  const syncFocusSound = () => {
    const { focusSound, focusVolume } = settings.get().timer;
    setFocusSound(focusSoundFor(timer.get(), focusSound, focusMuted.get(), bootEndsAt), focusVolume);
  };
  timer.subscribe(syncFocusSound);
  settings.subscribe(syncFocusSound);
  focusMuted.subscribe(syncFocusSound);
}

/**
 * Remaining seconds while the timer runs: once per second, on the boundary where the shown
 * second changes, or every 200 ms with `fast` (looks with tenths).
 */
export function useRemaining(fast = true): number {
  const s = timer.use();
  const running = s.endsAt !== null;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running || !fast) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [running, fast]);
  const tick = useSecondTick(running && !fast, (s.endsAt ?? 0) % 1000);
  // Clamped: for one render after a start the clock may still be from before it.
  return Math.min(s.duration, remainingOf(s, fast ? now : tick));
}

/**
 * Date.now(), re-rendering once each time the second changes while `active`: one setTimeout aimed just past the next boundary, no polling.
 * `phase` (ms) moves the boundary, so a countdown to `endsAt` ticks when its own seconds change (`endsAt % 1000`).
 */
export function useSecondTick(active: boolean, phase = 0): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const next = () => {
      const t = Date.now();
      setNow(t);
      id = window.setTimeout(next, 1000 - ((((t - phase) % 1000) + 1000) % 1000) + 5);
    };
    next();
    return () => window.clearTimeout(id);
  }, [active, phase]);
  return now;
}

/** The countdown as the bar and the Overview write it: "24:59", from an hour "1:05:00". */
export { formatClock } from "../teleprompter/model";
