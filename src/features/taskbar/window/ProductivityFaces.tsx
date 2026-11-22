// The faces of the bar's Stopwatch, Next to-do and Note preview widgets, which read what Crest already saves.

import { useSyncExternalStore } from "react";
import { motion } from "motion/react";
import { fade } from "../../../design/motion";
import { t } from "../../../i18n";
import { CAPTION_FONT, measureTabular } from "../../../notch/row/measure";
import type { PartId } from "../../../notch/row/parts";
import { settings } from "../../../settings/store";
import { ClockClockwise, Flag } from "../../../ui/iconset";
import { lookTint } from "../../timer/looks";
import { STOPWATCH_IDLE, elapsedOf, elapsedText, swPhase, type Stopwatch } from "../../timer/stopwatch";
import { stopwatch, useSecondTick } from "../../timer/store";
import { SAMPLE_STOPWATCH } from "../sampleFeed";
import type { Body, WidgetContext } from "./Widget";

/** What the stopwatch, the next to-do and the note preview read from their saved stores: the stopwatch and the time it is read at. */
export type Own = { stopwatch: Stopwatch; now: number };

/** For a widget that does not read the store: nothing to hear, and a value that never changes. */
const none = () => () => {};
const idleStopwatch = () => STOPWATCH_IDLE;

/**
 * The saved stores widget `id` draws from, undefined for one that reads none; `paused` while the bar rests. Each hears only its own
 * store, so typing a note re-renders no other widget, and only the running stopwatch ticks, on its own second, while the bar shows.
 */
export function useOwn(id: PartId, paused: boolean): Own | undefined {
  const s = useSyncExternalStore(id === "stopwatch" ? stopwatch.subscribe : none, id === "stopwatch" ? stopwatch.get : idleStopwatch);
  const now = useSecondTick(id === "stopwatch" && s.startedAt !== null && !paused, swPhase(s));
  return id === "stopwatch" ? { stopwatch: s, now } : undefined;
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

/** The stopwatch, the next to-do or the note's first line as the bar draws it; null while it has nothing to show. */
export function productivityPart(id: "stopwatch" | "todo" | "note", ctx: WidgetContext): Body | null {
  const { own, sample } = ctx;
  if (id === "stopwatch") {
    const s = sample ? SAMPLE_STOPWATCH : own && { elapsed: elapsedOf(own.stopwatch, own.now), running: own.stopwatch.startedAt !== null, laps: own.stopwatch.laps.length };
    // Never started or reset: the dimmed icon.
    if (!s || (!s.running && !s.elapsed && !s.laps)) return null;
    const text = elapsedText(s.elapsed);
    return { node: <StopwatchFace text={text} running={s.running} laps={s.laps} />, width: stopwatchWidth(text, s.laps) };
  }
  return null;
}
