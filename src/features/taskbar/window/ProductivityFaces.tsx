// The faces of the bar's Stopwatch, Next to-do, Note preview and Keep awake widgets, which read what Crest already saves or holds.

import { useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { fade } from "../../../design/motion";
import { t } from "../../../i18n";
import { ROW } from "../../../notch/row/layout";
import { CAPTION_FONT, measureTabular, measureText } from "../../../notch/row/measure";
import { useMinuteTick } from "../../../notch/row/parts/Clock";
import type { PartId } from "../../../notch/row/parts";
import { settings } from "../../../settings/store";
import { ClockClockwise, Coffee, Flag, NotePencil } from "../../../ui/iconset";
import { noteLine } from "../../notes/line";
import { note } from "../../notes/store";
import { AWAKE_MINUTES, awakeLeft, awakeOn, formatLeftMinutes, type Awake } from "../../overview/awake";
import { awake, startAwake, stopAwake } from "../../overview/store";
import { lookTint } from "../../timer/looks";
import { STOPWATCH_IDLE, elapsedOf, elapsedText, swPhase, type Stopwatch } from "../../timer/stopwatch";
import { stopwatch, useSecondTick } from "../../timer/store";
import { todoLine, type TodoLine } from "../../todos/model";
import { todos } from "../../todos/store";
import { variantOf } from "../model";
import { SAMPLE_AT, SAMPLE_AWAKE, SAMPLE_STOPWATCH, sampleNote, sampleTodo } from "../sampleFeed";
import { Row } from "./BarMenu";
import type { Body, WidgetContext } from "./Widget";

/**
 * What the stopwatch, the next to-do, the note preview and Keep awake read: the stopwatch and the time it is read at, the open
 * project's next task and the note's first line from their saved stores, and Keep awake as the notch holds it (barStores feedStores).
 */
export type Own = { stopwatch: Stopwatch; now: number; todo: TodoLine | null; note: string; awake: Awake };

/** For a widget that does not read the store: nothing to hear, and a value that never changes. */
const none = () => () => {};
const idleStopwatch = () => STOPWATCH_IDLE;
const noTodo = () => null;
const noNote = () => "";
const noAwake = () => null;
const leftShown = () => variantOf(settings.get().taskbar.variants, "keepawake") === "left";
const noLeft = () => false;

// Worked out again only when the store's value is another one, so the snapshot stays the same object (useSyncExternalStore).
let todoMemo: { state: unknown; line: TodoLine | null } = { state: null, line: null };
const todoNow = () => {
  const s = todos.get();
  if (todoMemo.state !== s) todoMemo = { state: s, line: todoLine(s.tasks, s.active) };
  return todoMemo.line;
};
let noteMemo = { text: "", line: "" };
const noteNow = () => {
  const text = note.get();
  // Another window's broken write arrives as it is: the bar shows nothing for it rather than failing.
  if (noteMemo.text !== text) noteMemo = { text, line: typeof text === "string" ? noteLine(text) : "" };
  return noteMemo.line;
};

/**
 * The stores widget `id` draws from, undefined for one that reads none; `paused` while the bar rests. Each hears only its own store,
 * so typing a note re-renders no other widget, and only the running stopwatch ticks, on its own second, while the bar shows. Keep
 * awake's time left turns once a minute, only in the version that shows it and while a timed one is on.
 */
export function useOwn(id: PartId, paused: boolean): Own | undefined {
  const s = useSyncExternalStore(id === "stopwatch" ? stopwatch.subscribe : none, id === "stopwatch" ? stopwatch.get : idleStopwatch);
  const now = useSecondTick(id === "stopwatch" && s.startedAt !== null && !paused, swPhase(s));
  const todo = useSyncExternalStore(id === "todo" ? todos.subscribe : none, id === "todo" ? todoNow : noTodo);
  const line = useSyncExternalStore(id === "note" ? note.subscribe : none, id === "note" ? noteNow : noNote);
  const a = useSyncExternalStore(id === "keepawake" ? awake.subscribe : none, id === "keepawake" ? awake.get : noAwake);
  const left = useSyncExternalStore(id === "keepawake" ? settings.subscribe : none, id === "keepawake" ? leftShown : noLeft);
  useMinuteTick(left && a?.endsAt != null && !paused);
  return id === "stopwatch" || id === "todo" || id === "note" || id === "keepawake" ? { stopwatch: s, now, todo, note: line, awake: a } : undefined;
}

const SW_ICON = 17, SW_GAP = 4, FLAG = 11, FLAG_GAP = 2, LAPS_GAP = 6;
const digitsWidth = (text: string) => measureTabular(text.replace(/\d/g, "8"));
const lapsWidth = (laps: number) => measureTabular(String(laps).replace(/\d/g, "8"), CAPTION_FONT);

/** Room for the time with every digit an 8, so it widens only at 10:00, 1:00:00 and 10:00:00, and for the laps behind their flag. */
export const stopwatchWidth = (text: string, laps: number) => SW_ICON + SW_GAP + digitsWidth(text) + (laps ? LAPS_GAP + FLAG + FLAG_GAP + lapsWidth(laps) : 0);

/** The stopwatch's time, in the Timer's colour while it runs and dimmed while paused, then the laps taken behind a flag. */
function StopwatchFace({ text, running, laps }: { text: string; running: boolean; laps: number }) {
  const tint = lookTint(settings.use().timer.color);
  return (
    <span className={`flex shrink-0 items-center whitespace-nowrap ${running ? "text-label" : "text-label-3"}`}>
      <ClockClockwise size={SW_ICON} weight="bold" className="shrink-0" style={running ? { color: tint } : undefined} />
      <span className="tabular text-footnote font-medium" style={{ marginInlineStart: SW_GAP, width: digitsWidth(text) }}>
        {text}
      </span>
      {/* Paused shows only as the dimmed colour: a screen reader hears it too. */}
      {!running && <span className="sr-only">{` ${t("Pausiert")}`}</span>}
      {laps > 0 && (
        <span className="flex items-center text-label-3" style={{ marginInlineStart: LAPS_GAP, gap: FLAG_GAP }}>
          <Flag size={FLAG} weight="fill" aria-hidden className="shrink-0" />
          {/* A new lap's count fades in where the last stood. */}
          <motion.span key={laps} aria-hidden className="tabular text-caption font-medium" style={{ width: lapsWidth(laps) }} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: fade }}>
            {laps}
          </motion.span>
          <span className="sr-only">{t(laps === 1 ? "{n} Runde" : "{n} Runden", { n: laps })}</span>
        </span>
      )}
    </span>
  );
}

const RING = 16, TODO_GAP = 6;
const todoText = (line: TodoLine) => (line.id ? line.text : t("Alles erledigt"));

/** The ring and the task's text, cut off past titleMax; it changes only with the task. */
export const todoWidth = (line: TodoLine) => RING + TODO_GAP + Math.min(ROW.titleMax, measureText(todoText(line)));

/**
 * The project's next task behind a ring filled by its share done, in the To-dos green, drawn as the timer's ring is: from the top,
 * its track faint, on fill-3 under Material. With every task done the ring is full and the text says so.
 */
function TodoFace({ line }: { line: TodoLine }) {
  const share = line.total ? (line.done / line.total) * 100 : 0;
  const full = share >= 99.9;
  return (
    <span className="flex items-center" style={{ gap: TODO_GAP }}>
      <svg width={RING} height={RING} viewBox="0 0 12 12" className="shrink-0 text-label" role="img" aria-label={t("{done} von {total} erledigt", { done: line.done, total: line.total })}>
        <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth="2" className="material:stroke-fill-3 material:[stroke-opacity:1]" />
        {share > 0 && (
          <circle
            cx="6" cy="6" r="5" fill="none" stroke="var(--color-green)" strokeWidth="2" strokeLinecap={full ? "butt" : "round"}
            pathLength={100} strokeDasharray={full ? "100 0" : `${share} 100`} transform="rotate(-90 6 6)"
          />
        )}
      </svg>
      {/* One cell: the next task fades in over the one just done. */}
      <span className="grid min-w-0 text-footnote font-medium whitespace-nowrap" style={{ maxWidth: ROW.titleMax }}>
        <AnimatePresence initial={false}>
          <motion.span
            key={line.id}
            dir="auto"
            className={`col-start-1 row-start-1 truncate ${line.id ? "text-label" : "text-label-3"}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: fade }}
            exit={{ opacity: 0, transition: fade }}
          >
            {todoText(line)}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  );
}

const NOTE_ICON = 15, NOTE_GAP = 6;
/** Always this room, as the song title keeps titleMax: typing in the Notes panel never moves the widgets beside it. */
const NOTE_WIDTH = NOTE_ICON + NOTE_GAP + ROW.titleMax;

/** The note's first line behind its pencil, in the Notes yellow; a short line sits centred in the room. */
function NoteFace({ text }: { text: string }) {
  return (
    <span className="flex min-w-0 items-center" style={{ gap: NOTE_GAP, maxWidth: NOTE_WIDTH }}>
      <NotePencil size={NOTE_ICON} weight="fill" className="shrink-0 text-yellow" />
      <span dir="auto" className="truncate text-footnote font-medium whitespace-nowrap text-label">
        {text}
      </span>
    </span>
  );
}

const CUP = 16, AWAKE_GAP = 4;

/** Keep awake on: the cup, and in the version with the time left a timed one's hours and minutes, as wide as with every digit an 8. */
function AwakeFace({ text }: { text: string | null }) {
  return (
    <span role="img" aria-label={t("PC bleibt wach")} className="flex shrink-0 items-center whitespace-nowrap text-label">
      <Coffee size={CUP} weight="fill" className="shrink-0" />
      {text && (
        <span className="tabular text-footnote font-medium" style={{ marginInlineStart: AWAKE_GAP, width: digitsWidth(text) }}>
          {text}
        </span>
      )}
    </span>
  );
}

/**
 * Keep awake while on, the label above it saying how long is left or that it lasts until turned off; off, null, and widgetBody fades
 * to the dimmed cup. Read at now, not at the last minute's tick: the icon version does not tick, and its label is read on a hover.
 */
function awakePart(ctx: WidgetContext): Body | null {
  const a = ctx.sample ? SAMPLE_AWAKE : (ctx.own?.awake ?? null);
  const now = ctx.sample ? SAMPLE_AT : Date.now();
  if (!awakeOn(a, now)) return null;
  const left = awakeLeft(a, now);
  const text = left !== null && variantOf(ctx.variants, "keepawake") === "left" ? formatLeftMinutes(left) : null;
  return {
    node: <AwakeFace text={text} />,
    width: CUP + (text ? AWAKE_GAP + digitsWidth(text) : 0),
    tip: left === null ? t("An") : t("noch {time}", { time: formatLeftMinutes(left) }),
  };
}

/** The stopwatch, the next to-do, the note's first line or Keep awake as the bar draws it; null while it has nothing to show. */
export function productivityPart(id: "stopwatch" | "todo" | "note" | "keepawake", ctx: WidgetContext): Body | null {
  const { own, sample } = ctx;
  if (id === "keepawake") return awakePart(ctx);
  if (id === "stopwatch") {
    const s = sample ? SAMPLE_STOPWATCH : own && { elapsed: elapsedOf(own.stopwatch, own.now), running: own.stopwatch.startedAt !== null, laps: own.stopwatch.laps.length };
    // Never started or reset: the dimmed icon.
    if (!s || (!s.running && !s.elapsed && !s.laps)) return null;
    const text = elapsedText(s.elapsed);
    return { node: <StopwatchFace text={text} running={s.running} laps={s.laps} />, width: stopwatchWidth(text, s.laps) };
  }
  if (id === "todo") {
    const line = sample ? sampleTodo() : own?.todo;
    return line ? { node: <TodoFace line={line} />, width: todoWidth(line) } : null;
  }
  const text = sample ? sampleNote() : own?.note;
  return text ? { node: <NoteFace text={text} />, width: NOTE_WIDTH } : null;
}

/**
 * Keep awake's durations and Until turned off, as Overview's tile offers them, the one on checked, then Off while it is on, over the
 * widget's Crest menu rows (widgets.ts hasWidgetMenu). The bar asks the notch, which holds it (overview/store.ts).
 */
export function AwakeRows({ close }: { close: () => void; openTool: (tool: string) => void }) {
  const a = awake.use();
  // The notch turns a timed one off as it ends: off is null.
  const on = a !== null;
  const run = (action: () => void) => () => {
    close();
    action();
  };
  return (
    <>
      {AWAKE_MINUTES.map((m) => (
        <Row key={m} label={m < 60 ? t("{n} Min.", { n: m }) : t("{n} Std.", { n: m / 60 })} checked={on && a.minutes === m} onClick={run(() => startAwake(m))} />
      ))}
      <Row label={t("Bis zum Ausschalten")} checked={on && a.minutes === null} onClick={run(() => startAwake(null))} />
      <Row label={t("Aus")} disabled={!on} onClick={run(stopAwake)} />
      <div className="h-px bg-separator my-1" />
    </>
  );
}
