import { useEffect, useState } from "react";
import { useSecondTick } from "../../../features/timer/store";
import { locale } from "../../../i18n";
import { measureText } from "../measure";

/** The time as the language writes it, with its own digits and day period. */
const format = (seconds: boolean, h12: boolean) =>
  new Intl.DateTimeFormat(locale(), { hour: h12 ? "numeric" : "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hourCycle: h12 ? "h12" : "h23" });

/** Fixed room: a two-digit hour, and the wider of the morning and the evening on a 12 h clock. */
export function clockWidth(seconds: boolean, h12: boolean): number {
  const f = format(seconds, h12);
  return Math.max(...[10, 22].map((h) => measureText(f.format(new Date(2000, 0, 1, h, 8, 8)))));
}

/** Re-renders once a minute, 50 ms after it turns. */
function useMinuteTick(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const next = () => {
      const t = Date.now();
      setNow(t);
      id = window.setTimeout(next, 60_000 - (t % 60_000) + 50);
    };
    next();
    return () => window.clearTimeout(id);
  }, [active]);
  return now;
}

/** `paused` (under a notice) stops the ticking; it catches up on the first tick after. */
export function Clock({ seconds, h12, paused }: { seconds: boolean; h12: boolean; paused: boolean }) {
  const minute = useMinuteTick(!seconds && !paused), second = useSecondTick(seconds && !paused);
  const time = format(seconds, h12).format(seconds ? second : minute);
  return (
    <span className="tabular block whitespace-nowrap text-center text-footnote font-medium text-label" style={{ width: clockWidth(seconds, h12) }}>
      {time}
    </span>
  );
}
