import { createStore } from "../../lib/store";
import { settings } from "../../settings/store";
import { systemControls } from "../../platform/services";
import { focusMode } from "../../notch/focus";
import { across } from "../../notch/edge";
import { notchOpen } from "../../notch/useNotchState";
import { closedEdit } from "../../notch/ClosedResize";
import { fullscreen } from "../system/gaming";
import { presentingNow, privacy } from "../privacy/store";
import { inQuiet } from "../notices/rules";
import { screen } from "../window/store";
import { recording } from "../capture/store";
import { timer } from "../timer/store";
import { asks } from "../notices/store";
import { calendarDue } from "../calendar/store";
import { dueTasks } from "../todos/store";
import { BREAKS_DEFAULTS, advance, canStart, fresh, normalizeBreaks, skip, snooze, start, suspend, type BreakState, type BreaksConfig, type ShownBreak } from "./breaks";
import { idleSeconds } from "./idle";

/*
 * Break reminders (breaks.ts has the rules). Off by default; while on, one poll every POLL_MS asks Rust how long the user has been
 * away (idle.rs) and moves the state machine along, and one timeout ends a break exactly when its time is up. Nothing runs while it is off.
 */

export const breaksConfig = createStore<BreaksConfig>(BREAKS_DEFAULTS, { persist: "breaks" });
// A broken or foreign entry becomes the defaults rather than NaN intervals.
breaksConfig.set((s) => normalizeBreaks(s));

/** The break on the closed notch now (NoticeLayer), null between breaks. */
export const breakShown = createStore<ShownBreak | null>(null);

/** How often the idle time is asked for. */
const POLL_MS = 15_000;
/** Do Not Disturb is read when a break is about to start; while it is on, not more often than this. */
const FOCUS_RECHECK_MS = 60_000;

let state: BreakState = fresh();
let poll: number | undefined;
let endTimer: number | undefined;
let focusOnAt = 0;

function apply(next: BreakState) {
  state = next;
  // The same object while nothing started or ended, so the notch only re-renders on a change.
  if (breakShown.get() !== next.shown) breakShown.set(next.shown);
  window.clearTimeout(endTimer);
  if (next.shown) endTimer = window.setTimeout(() => void tick(false), Math.max(0, next.shown.endsAt - Date.now()) + 50);
}

/** What keeps a break away, using what the notices and the status alerts already know. Do Not Disturb is read separately (it is async). */
function held(): boolean {
  const { display, dock, notices } = settings.get();
  const d = new Date();
  return (
    presentingNow() ||
    // The open notch and the resizing of the closed row hide the row, and the break with it.
    notchOpen.get() ||
    closedEdit.get() ||
    fullscreen.get() ||
    focusMode.get() ||
    // A window rule that hides the notch or turns it into the line, or the line as the closed look.
    screen.get() !== "normal" ||
    display.idleStyle === "line" ||
    // A notice that outranks the break on the row and stays until someone closes it (notch/row/notices.ts) hides its card, and the
    // break would run out unseen and count as taken. It stays due instead and shows once that notice is gone.
    recording.get().phase !== "idle" ||
    timer.get().finished ||
    asks.get().length > 0 ||
    !!calendarDue.get() ||
    dueTasks.get().length > 0 ||
    // On a side edge the notch is a column: it has no room for a card.
    (display.idleStyle !== "capsule" && across(dock.edge)) ||
    (notices.quiet.on && inQuiet(d.getHours() * 60 + d.getMinutes(), notices.quiet.from, notices.quiet.to))
  );
}

/** Windows' Do Not Disturb or focus session; a read that fails (a Mac has no such command) counts as off. */
async function dnd(): Promise<boolean> {
  if (Date.now() - focusOnAt < FOCUS_RECHECK_MS) return true;
  const on = await systemControls.focus().then((f) => f.active, () => false);
  if (on) focusOnAt = Date.now();
  return on;
}

/** One step: `ask` = read the idle time too (the poll); the timeout at the end of a break does not. */
async function tick(ask: boolean) {
  if (!breaksConfig.get().on) return;
  const idle = ask ? await idleSeconds() : null;
  const cfg = breaksConfig.get();
  if (!cfg.on) return; // switched off while the idle time was being read
  apply(advance(state, Date.now(), idle, cfg));
  if (held()) return apply(suspend(state));
  if (!canStart(state, Date.now(), cfg)) return;
  const away = await dnd();
  const now = Date.now();
  // Anything may have changed while Do Not Disturb was being read.
  if (away || held() || !breaksConfig.get().on) return;
  apply(start(state, now, breaksConfig.get(), false));
}

function configure() {
  const { on } = breaksConfig.get();
  window.clearInterval(poll);
  poll = undefined;
  // Any change of the settings starts the cycle over, as turning on does: the first break is a full interval away.
  apply(fresh(state.longs));
  if (!on) return;
  poll = window.setInterval(() => void tick(true), POLL_MS);
  void tick(true);
}

export const breaksActions = {
  skip: () => apply(skip(state)),
  snooze: () => apply(snooze(state, Date.now())),
  setConfig: (patch: Partial<BreaksConfig>) => breaksConfig.set((cur) => normalizeBreaks({ ...cur, ...patch })),
};

const cycleKey = (c: BreaksConfig) => `${c.on}|${c.microEveryMin}|${c.longEveryMin}|${c.longMin}`;

export function startBreaks() {
  let key = cycleKey(breaksConfig.get());
  breaksConfig.subscribe(() => {
    const next = cycleKey(breaksConfig.get());
    if (next === key) return;
    key = next;
    configure();
  });
  // A presentation, a full-screen app or a notice that covers it starting while a break shows takes it off the screen at once; it
  // comes back (next poll) when that ends. Do Not Disturb is only read when a break is about to start, not watched.
  const hide = () => {
    if (state.shown && held()) apply(suspend(state));
  };
  [notchOpen, closedEdit, fullscreen, privacy, focusMode, screen, settings, recording, timer, asks, calendarDue, dueTasks].forEach((s) => s.subscribe(hide));
  if (breaksConfig.get().on) configure();
}
