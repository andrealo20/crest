// Words for notices: short times and crest-notify run results. Pure; `tr` is passed in so this stays free of i18n.
import type { Notice } from "./history";

type Tr = (de: string, vars?: Record<string, string | number>) => string;

/** 850 ms, 12 s, 1 min 12 s, 2 h 5 min. */
export function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return rs ? `${m} min ${rs} s` : `${m} min`;
  const h = Math.floor(m / 60), rm = m % 60;
  return rm ? `${h} h ${rm} min` : `${h} h`;
}

function clock(d: Date, format: "24" | "12"): string {
  const h = d.getHours(), mm = String(d.getMinutes()).padStart(2, "0");
  return format === "24" ? `${String(h).padStart(2, "0")}:${mm}` : `${h % 12 || 12}:${mm} ${h < 12 ? "am" : "pm"}`;
}

/** "Now", "5 min", the clock time today, "Yesterday 14:05" before that. */
export function shortTime(at: number, now: number, format: "24" | "12", tr: Tr): string {
  const ago = now - at;
  if (ago < 60_000) return tr("Jetzt");
  if (ago < 60 * 60_000) return tr("{n} Min.", { n: Math.floor(ago / 60_000) });
  const d = new Date(at), today = new Date(now);
  if (d.toDateString() === today.toDateString()) return clock(d, format);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return tr("Gestern {t}", { t: clock(d, format) });
  return `${d.getDate()}/${d.getMonth() + 1} ${clock(d, format)}`;
}

/** The text under a notice's title: its body, or for `crest-notify run` the result. */
export function noticeText(n: Notice, tr: Tr): string {
  if (n.exitCode === undefined || n.exitCode === null) return n.body;
  const took = duration(n.durationMs ?? 0);
  return n.exitCode === 0 ? tr("Fertig nach {d}", { d: took }) : tr("Fehlgeschlagen (Code {c}) nach {d}", { c: n.exitCode, d: took });
}

/** One line for the closed notch: title and the first line of the text. */
export function popLine(n: Notice, tr: Tr): string {
  const first = noticeText(n, tr).split("\n")[0].trim();
  return [n.title, first].filter(Boolean).join(" · ");
}
