import type { ReactNode } from "react";
import { Dial, ICON_COLORS, READING_GAP, ReadingView, digits, readingWidth, type Reading } from "../../../notch/row/parts/Readings";
import { settings } from "../../../settings/store";
import { schemeColor } from "../../system/levels";
import { activeTheme } from "../../themes/store";

/*
 * The hardware's versions on Crest's bar beside today's dials: CPU, RAM and GPU as bars, and CPU's last 30 s as a line. The readings
 * are the ones switched on for the notch; those a version has no shape for follow as today's dials. Fixed widths for their input.
 */

const BARRED = ["cpu", "ram", "gpu"] as const;
const LETTER: Record<(typeof BARRED)[number], string> = { cpu: "C", ram: "M", gpu: "G" };
/** A bar's letter, the room after it and the bar; Readings.tsx's dial; the line's box and the room on each side. */
const MARK = 6, MARK_GAP = 4, BAR = 34, BARS = MARK + MARK_GAP + BAR, DIAL = 16, LINE_W = 40, LINE_H = 16, LINE_GAP = 3;

const barred = (r: Reading) => (BARRED as readonly string[]).includes(r.id);
const sum = (widths: number[]) => widths.reduce((s, w, i) => s + (i ? READING_GAP : 0) + w, 0);

/** The value's colour as ReadingView takes it, and the icon's own while coloured icons are on (never on a themed closed notch). */
function useColors(r: Reading): { color: string; icon: string | undefined } {
  const { system: sys, themes: { iconColors } } = settings.use();
  const themedNotch = !!activeTheme.use().closedNotch;
  return { color: schemeColor(sys.colors, r.level), icon: iconColors && !themedNotch ? ICON_COLORS[r.id] : undefined };
}

const percent = (r: Reading) => (r.value === null ? "-" : `${Math.round(r.value)}%`);

/** One reading as a letter and a bar filled to its share. */
function Bar({ reading: r }: { reading: Reading }) {
  const { color, icon } = useColors(r);
  const share = Math.min(100, Math.max(0, r.value ?? 0));
  return (
    <span className="flex items-center" style={{ gap: MARK_GAP, color }} role="img" aria-label={`${r.id.toUpperCase()} ${percent(r)}`}>
      <span className="text-[8px] leading-none font-bold" style={{ width: MARK, color: icon }}>
        {LETTER[r.id as keyof typeof LETTER]}
      </span>
      <span className="relative block h-1 overflow-hidden rounded-full material:bg-secondary-container!" style={{ width: BAR, background: "color-mix(in srgb, currentColor 25%, transparent)" }}>
        <span className="absolute inset-y-0 left-0 block rounded-full bg-current" style={{ width: (BAR * share) / 100 }} />
      </span>
    </span>
  );
}

/** The others as today's dials, after the version's own shape. */
const rest = (list: Reading[]) => list.map((r) => <ReadingView key={r.id} reading={r} />);
const inRow = (nodes: ReactNode[]) => <span className="flex shrink-0 items-center" style={{ gap: READING_GAP }}>{nodes}</span>;

export const barsWidth = (readings: Reading[]) => sum([...(readings.some(barred) ? [BARS] : []), ...readings.filter((r) => !barred(r)).map((r) => readingWidth(r.id))]);

/** CPU, RAM and GPU as switched on, one bar each in a column, then the other readings as dials. */
export function ReadingBars({ readings }: { readings: Reading[] }) {
  const bars = readings.filter(barred);
  return inRow([
    bars.length > 0 && (
      // 4 px apart, 2 with three bars, so three 8 px rows stay inside the closed row's 30 px.
      <span key="bars" className="flex shrink-0 flex-col" style={{ gap: bars.length > 2 ? 2 : 4 }}>
        {bars.map((r) => <Bar key={r.id} reading={r} />)}
      </span>
    ),
    ...rest(readings.filter((r) => !barred(r))),
  ]);
}

export const lineWidth = (readings: Reading[]) => sum([DIAL + LINE_GAP + LINE_W + LINE_GAP + digits("cpu"), ...readings.filter((r) => r.id !== "cpu").map((r) => readingWidth(r.id))]);

/** The line's points in a 40 x 16 box, 0 % at the bottom and 100 % at the top; anything but a number is a gap and skipped (the dev sample may keep NaN). */
function linePoints(spark: (number | null)[]): [number, number][] {
  const step = LINE_W / Math.max(1, spark.length - 1);
  return spark.flatMap((v, i) => (typeof v !== "number" || Number.isNaN(v) ? [] : [[+(i * step).toFixed(1), +(15 - (Math.min(100, Math.max(0, v)) / 100) * 14).toFixed(1)] as [number, number]]));
}

/** CPU's dial, its last 30 s as a line and its figure; the other readings as dials after it. The caller draws it only with CPU among `readings`. */
export function ReadingLine({ readings, spark }: { readings: Reading[]; spark: (number | null)[] }) {
  const cpu = readings.find((r) => r.id === "cpu")!;
  const { color, icon } = useColors(cpu);
  const pts = linePoints(spark), line = pts.map((p) => p.join(",")).join(" ");
  return inRow([
    <span key="cpu" className="flex shrink-0 items-center" style={{ gap: LINE_GAP, color }} role="img" aria-label={`CPU ${percent(cpu)}`}>
      <span className="flex shrink-0" style={{ color: icon }}>
        <Dial letter="C" value={cpu.value ?? 0} arc={icon ? color : undefined} />
      </span>
      <svg width={LINE_W} height={LINE_H} viewBox={`0 0 ${LINE_W} ${LINE_H}`} className="shrink-0" aria-hidden>
        {pts.length > 1 && (
          <>
            <polygon points={`${pts[0][0]},${LINE_H} ${line} ${pts[pts.length - 1][0]},${LINE_H}`} fill="currentColor" fillOpacity={0.15} />
            <polyline points={line} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
          </>
        )}
      </svg>
      <span className="tabular text-left text-footnote font-medium" style={{ width: digits("cpu") }} aria-hidden>
        {percent(cpu)}
      </span>
    </span>,
    ...rest(readings.filter((r) => r.id !== "cpu")),
  ]);
}
