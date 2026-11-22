import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlarmIcon, ArrowCounterClockwise, Check, CheckCircle, ClockClockwise, Flag, Pause, PencilSimple, PictureInPicture, Play, SpeakerSimpleHigh, SpeakerSimpleSlash, X } from "../../ui/iconset";
import { content, pulse, springs } from "../../design/motion";
import {
  focusMuted,
  formatClock,
  presets,
  remembered,
  ringing,
  setFocusMuted,
  stopRinging,
  stopwatch,
  stopwatchActions,
  timer,
  timerActions,
  timerTab,
  useRemaining,
  useSecondTick,
  type TimerMode,
} from "./store";
import { Look } from "./Look";
import { lookTint, modeTint } from "./looks";
import { durationText, parseDuration, wheelStep } from "./duration";
import { MAX_LAPS, elapsedOf, elapsedText, idle, lapText, splits, swPhase } from "./stopwatch";
import { detached, toggleDetached } from "./detach";
import { settings } from "../../settings/store";
import { HeaderActions, HeaderButton } from "../../notch/header";
import { isNative } from "../../platform/native";
import { isNotchWindow } from "../../lib/windowKind";
import { wheelSideways } from "../window/panel";
import { t } from "../../i18n";

const modeLabel: Record<TimerMode, string> = { focus: "Fokus", break: "Pause" };

/** The detached window is the notch's to open and close (`timer_window_open`), so the bar's panel shows no button for it. */
const detachable = isNative && isNotchWindow;

/*
 *   [Focus | Break | ⏱]           15  25  45  [2:30]  [37]  [✎]
 *   24:59  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  [↺] [⏯]
 *
 * Custom time: ✎ opens a field for minutes, M:SS or H:MM:SS, or scroll over the big time
 * (±1 min, Shift ±5), only while the timer isn't running. The last three started stay as chips.
 */
export function TimerView() {
  const s = timer.use();
  const tab = timerTab.use();
  // The bar's Show laps opens the stopwatch; whatever opens the Timer next finds the countdown again.
  useEffect(() => {
    views++;
    return () => {
      views--;
      // Later, and only with no view left: StrictMode unmounts a view and mounts it again at once in development.
      window.setTimeout(() => {
        if (!views) timerTab.set("timer");
      });
    };
  }, []);
  return (
    <>
      <TimerHeader />
      {tab === "stopwatch" ? <StopwatchView /> : s.finished ? <FinishedView /> : <SetupView />}
    </>
  );
}

/** Timer views shown in this window. */
let views = 0;

/**
 * A segment's click: the stopwatch only shows its page; Focus or Break shows the countdown and selects that mode only when it is
 * another, with its last remembered or its default duration, so a click on the selected mode keeps the time set.
 */
function pickTab(m: TimerMode | "stopwatch") {
  timerTab.set(m === "stopwatch" ? "stopwatch" : "timer");
  const s = timer.get();
  if (m !== "stopwatch" && m !== s.mode) timerActions.select(m, remembered(s, m)[0] ?? presets[m][m === "focus" ? 1 : 0]);
}

/** Mutes the focus sound for now, and pops the timer into its own small always-on-top window, or takes it back. */
function TimerHeader() {
  const open = detached.use();
  const sound = settings.use().timer.focusSound;
  const muted = focusMuted.use();
  if (!detachable && sound === "off") return null;
  return (
    <HeaderActions>
      {sound !== "off" && (
        <HeaderButton label={muted ? t("Fokus-Klang einschalten") : t("Fokus-Klang stummschalten")} onClick={() => setFocusMuted(!muted)}>
          {muted ? <SpeakerSimpleSlash size={14} weight="bold" /> : <SpeakerSimpleHigh size={14} weight="bold" />}
        </HeaderButton>
      )}
      {detachable && (
        <HeaderButton label={open ? t("Timer-Fenster schließen") : t("Timer abdocken")} active={open} onClick={toggleDetached}>
          <PictureInPicture size={14} weight="bold" />
        </HeaderButton>
      )}
    </HeaderActions>
  );
}

/*
 *   ✓ Focus finished
 *   0:00  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  [🔕] or [✕]
 *
 * Stays until dismissed. While ringing: stop the alarm; after that only ✕.
 */
function FinishedView() {
  const s = timer.use();
  const ring = ringing.use();
  const { look, color } = settings.use().timer;
  const tint = modeTint(s.mode, color);
  return (
    <motion.div
      className="flex h-full flex-col justify-between px-5 pt-1 pb-2"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: content.enter }}
    >
      <div className="flex h-7 items-center gap-2 text-footnote font-semibold" style={{ color: tint }}>
        {ring ? (
          <motion.span className="flex" animate={{ opacity: [1, 0.35] }} transition={pulse}>
            <AlarmIcon size={15} weight="fill" />
          </motion.span>
        ) : (
          <CheckCircle size={15} weight="fill" />
        )}
        {t(s.mode === "focus" ? "Fokus abgelaufen" : "Pause abgelaufen")}
        <span className="font-medium text-label-3">· {formatClock(s.duration)}</span>
      </div>
      <div className="flex items-center gap-4">
        <motion.div
          className="flex min-w-0 flex-1"
          animate={{ opacity: ring ? [1, 0.45] : 1 }}
          transition={ring ? pulse : content.enter}
        >
          <Look look={look} remaining={0} duration={s.duration} running={false} mode={s.mode} tint={tint} h={44} />
        </motion.div>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={ring ? "silence" : "close"}
            initial={{ opacity: 0, transform: "scale(0.6)", filter: "blur(3px)" }}
            animate={{ opacity: 1, transform: "scale(1)", filter: "blur(0px)" }}
            exit={{ opacity: 0, transform: "scale(0.6)", filter: "blur(3px)" }}
            transition={content.exit}
          >
            {ring ? (
              <RoundButton label={t("Alarm stoppen")} onClick={stopRinging} tint={tint}>
                <SpeakerSimpleSlash size={17} weight="fill" />
              </RoundButton>
            ) : (
              <RoundButton label={t("Schließen")} onClick={timerActions.dismiss}>
                <X size={16} weight="bold" />
              </RoundButton>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function SetupView() {
  const s = timer.use();
  const look = settings.use().timer.look;
  // Only the HUD shows tenths; the other looks change once a second.
  const remaining = useRemaining(look === "hud");
  const running = s.endsAt !== null;
  const tint = modeTint(s.mode, settings.use().timer.color);
  const [editing, setEditing] = useState(false);
  const clockRef = useRef<HTMLDivElement>(null);

  // The wheel sets the minutes. Only when not started; passive:false for preventDefault.
  const editable = !running && remaining === s.duration;
  useEffect(() => {
    const el = clockRef.current;
    if (!el || !editable) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = (e.shiftKey ? 5 : 1) * (e.deltaY < 0 ? 1 : -1);
      timerActions.setDuration(wheelStep(timer.get().duration, step));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [editable]);

  const chips = [...presets[s.mode], ...remembered(s, s.mode).sort((a, b) => a - b)];

  return (
    <div className="flex h-full flex-col justify-between px-5 pt-1 pb-2">
      <div className="flex h-7 items-center justify-between">
        <Segmented
          locked={running ? s.mode : null}
          value={s.mode}
          onChange={(m) => {
            setEditing(false);
            pickTab(m);
          }}
        />
        {/* Chips and duration field are stacked right-aligned, so nothing jumps sideways on switch. */}
        <div className="relative flex h-6 flex-1 justify-end">
        <AnimatePresence initial={false}>
          {editing ? (
            <DurationInput
              key="input"
              initial={s.duration}
              tint={tint}
              onDone={(seconds) => {
                if (seconds !== null) timerActions.setDuration(seconds);
                setEditing(false);
              }}
            />
          ) : (
            <motion.div
              key="chips"
              className="absolute top-0 end-0 flex gap-1"
              initial={{ opacity: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, filter: "blur(0px)", transition: content.enter }}
              exit={{ opacity: 0, filter: "blur(4px)", transition: content.exit }}
            >
              {chips.map((d) => (
                <button
                  key={d}
                  onClick={() => timerActions.select(s.mode, d)}
                  disabled={running}
                  aria-label={d % 60 ? durationText(d) : t("{n} Min.", { n: d / 60 })}
                  aria-pressed={d === s.duration}
                  className={`pressable pressable-fill tabular h-6 min-w-7 rounded-full px-2.5 text-caption font-medium disabled:opacity-40 ${
                    d === s.duration ? "bg-fill-2 text-label" : "text-label-3"
                  }`}
                >
                  {durationText(d)}
                </button>
              ))}
              <button
                aria-label={t("Eigene Zeit")}
                title={t("Eigene Zeit (oder Mausrad über der Zeit)")}
                onClick={() => setEditing(true)}
                className="pressable pressable-fill flex size-6 items-center justify-center rounded-full text-label-3 hover:text-label-2"
              >
                <PencilSimple size={12} weight="bold" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div ref={clockRef} title={editable ? t("Mausrad: ±1 min, Shift: ±5 min") : undefined} className="flex min-w-0 flex-1">
          <Look look={look} remaining={remaining} duration={s.duration} running={running} mode={s.mode} tint={tint} h={44} />
        </div>
        <div className="flex gap-1.5">
          <RoundButton label={t("Zurücksetzen")} onClick={timerActions.reset} disabled={editable}>
            <ArrowCounterClockwise size={16} weight="bold" />
          </RoundButton>
          <RoundButton
            label={running ? t("Pause") : t("Start")}
            onClick={running ? timerActions.pause : timerActions.start}
            tint={tint}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={running ? "pause" : "play"}
                className="flex"
                initial={{ opacity: 0, transform: "scale(0.6)", filter: "blur(3px)" }}
                animate={{ opacity: 1, transform: "scale(1)", filter: "blur(0px)" }}
                exit={{ opacity: 0, transform: "scale(0.6)", filter: "blur(3px)" }}
                transition={content.exit}
              >
                {running ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
              </motion.span>
            </AnimatePresence>
          </RoundButton>
        </div>
      </div>
    </div>
  );
}

/** Duration field, minutes, M:SS or H:MM:SS (duration.ts parseDuration): Enter/✓ applies, Esc or blur cancels. */
function DurationInput(props: { initial: number; tint: string; onDone: (seconds: number | null) => void }) {
  const [value, setValue] = useState(durationText(props.initial));
  const ref = useRef<HTMLInputElement>(null);
  const seconds = parseDuration(value);
  const valid = seconds !== null;

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.select();
  }, []);

  return (
    <motion.form
      className="absolute top-0 end-0 flex items-center gap-1.5"
      initial={{ opacity: 0, filter: "blur(4px)" }}
      animate={{ opacity: 1, filter: "blur(0px)", transition: content.enter }}
      exit={{ opacity: 0, filter: "blur(4px)", transition: content.exit }}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) props.onDone(seconds);
      }}
    >
      <div className="flex h-6 items-center gap-1 rounded-full bg-fill-2 pe-2.5 ps-2.5">
        {/* No numeric keyboard: it has no colon. "24:00:00" is the longest the field takes. */}
        <input
          ref={ref}
          value={value}
          maxLength={8}
          title={t("Minuten, M:SS oder H:MM:SS")}
          aria-label={t("Minuten, M:SS oder H:MM:SS")}
          onChange={(e) => setValue(e.target.value.replace(/[^\d:]/g, ""))}
          onKeyDown={(e) => {
            // Only catch Esc here, don't close the whole notch.
            if (e.key === "Escape") {
              e.stopPropagation();
              props.onDone(null);
            }
          }}
          onBlur={(e) => {
            if (!e.currentTarget.form?.contains(e.relatedTarget as Node)) props.onDone(null);
          }}
          className="tabular w-14 bg-transparent text-end text-caption font-semibold text-label outline-none"
        />
        {!value.includes(":") && <span className="text-caption text-label-3">{t("min")}</span>}
      </div>
      <button
        type="submit"
        aria-label={t("Übernehmen")}
        disabled={!valid}
        className="pressable flex size-6 items-center justify-center rounded-full disabled:opacity-30"
        style={{ color: props.tint, backgroundColor: `color-mix(in srgb, ${props.tint} 18%, transparent)` }}
      >
        <Check size={12} weight="bold" />
      </button>
    </motion.form>
  );
}

/** Focus, Break and the stopwatch, the last as its icon alone. While a timer runs (`locked`, its mode) the other mode is off; the stopwatch never is. */
function Segmented({ value, onChange, locked }: { value: TimerMode | "stopwatch"; onChange: (m: TimerMode | "stopwatch") => void; locked: TimerMode | null }) {
  return (
    <div className="flex rounded-full bg-fill-1 p-0.5 material:overflow-hidden material:bg-transparent material:shadow-[inset_0_0_0_1px_var(--color-label-3)]">
      {([...(Object.keys(modeLabel) as TimerMode[]), "stopwatch"] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          disabled={locked !== null && m !== "stopwatch" && m !== locked}
          aria-label={m === "stopwatch" ? t("Stoppuhr") : undefined}
          title={m === "stopwatch" ? t("Stoppuhr") : undefined}
          className={`relative h-6 rounded-full text-caption font-medium transition-colors duration-150 disabled:opacity-40 ${m === "stopwatch" ? "px-2.5" : "px-3"} ${
            m === value ? "text-on-secondary-container" : "text-label-3 hover:text-label-2"
          }`}
        >
          {m === value && (
            <motion.span layoutId="timer-mode" className="absolute inset-0 rounded-full bg-secondary-container" transition={springs.snappy} />
          )}
          {m === "stopwatch" ? (
            <span className="relative flex">
              <ClockClockwise size={13} weight="bold" />
            </span>
          ) : (
            <span className="relative">{t(modeLabel[m])}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/*
 *   [Focus | Break | ⏱]               3 0:41.2   2 1:03.7   1 0:58.0
 *   12:34  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  [⚑] [⏯]
 *
 * The laps newest first, each its own time; the wheel scrolls them sideways. Lap while it runs, Reset while it is paused.
 */
function StopwatchView() {
  const s = stopwatch.use();
  const tm = timer.use();
  const { look, color } = settings.use().timer;
  const running = s.startedAt !== null;
  // Ticks when the counted time's own second changes, only while it runs and this page shows.
  const elapsed = elapsedOf(s, useSecondTick(running, swPhase(s)));
  const tint = lookTint(color);
  const laps = splits(s.laps);
  return (
    <div className="flex h-full flex-col justify-between px-5 pt-1 pb-2">
      <div className="flex h-7 items-center gap-3">
        <Segmented locked={tm.endsAt !== null ? tm.mode : null} value="stopwatch" onChange={pickTab} />
        <div ref={wheelSideways} role="list" className="flex h-6 min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">
          {laps.map((_, i) => {
            // Newest first, the first pushed to the end of the row by its auto margin; with more than fit it scrolls from the newest.
            const n = laps.length - i, time = lapText(laps[n - 1]);
            return (
              <span
                key={n}
                role="listitem"
                aria-label={t("Runde {n}: {time}", { n, time })}
                className={`tabular flex h-6 shrink-0 items-center gap-1 rounded-full bg-fill-1 px-2.5 text-caption font-medium whitespace-nowrap text-label-2 ${i ? "" : "ms-auto"}`}
              >
                <span aria-hidden className="text-label-3">{n}</span>
                <span aria-hidden>{time}</span>
              </span>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex min-w-0 flex-1">
          {/* Analog would read the minutes and seconds as a time of day; its sweep is the second's round of the minute. */}
          <Look
            look={look === "analog" ? "clean" : look}
            remaining={60 - ((elapsed / 1000) % 60)}
            duration={60}
            running={running}
            mode="focus"
            tint={tint}
            h={44}
            clock={{ text: elapsedText(elapsed), caption: t("Stoppuhr") }}
          />
        </div>
        <div className="flex gap-1.5">
          {running ? (
            <RoundButton label={t("Runde")} onClick={stopwatchActions.lap} disabled={s.laps.length >= MAX_LAPS}>
              <Flag size={16} weight="bold" />
            </RoundButton>
          ) : (
            <RoundButton label={t("Zurücksetzen")} onClick={stopwatchActions.reset} disabled={idle(s)}>
              <ArrowCounterClockwise size={16} weight="bold" />
            </RoundButton>
          )}
          <RoundButton label={running ? t("Pause") : t("Start")} onClick={stopwatchActions.toggle} tint={tint}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={running ? "pause" : "play"}
                className="flex"
                initial={{ opacity: 0, transform: "scale(0.6)" }}
                animate={{ opacity: 1, transform: "scale(1)" }}
                exit={{ opacity: 0, transform: "scale(0.6)" }}
                transition={content.exit}
              >
                {running ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
              </motion.span>
            </AnimatePresence>
          </RoundButton>
        </div>
      </div>
    </div>
  );
}

function RoundButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tint?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      className="pressable pressable-fill flex size-10 items-center justify-center rounded-full bg-fill-1 text-label disabled:opacity-30"
      style={props.tint ? { color: props.tint, backgroundColor: `color-mix(in srgb, ${props.tint} 18%, transparent)` } : undefined}
    >
      {props.children}
    </button>
  );
}
