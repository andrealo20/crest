import { locale, t } from "../../i18n";
import { formatTime } from "../../lib/format";
import type { UsageProvider, UsageWindow } from "../../platform/services";
import { settings } from "../../settings/store";
import { dayGap, freshReading, pace, paceLines } from "./forecast";

/** The caption text's line height and the gap above the line (text-caption, mt-0.5): what each line costs the card. */
const LINE_PX = 14, GAP_PX = 2;

/** "4:40 PM" today, "Sat 4:40 PM" within the week, "Nov 18, 4:40 PM" farther out. 12 or 24 h as the clock setting says, order and words as the language. */
function when(at: number, now: number): string {
  const gap = dayGap(at, now);
  if (gap === 0) return formatTime(at);
  const h12 = settings.get().units.clock === "12";
  const day: Intl.DateTimeFormatOptions = gap < 7 ? { weekday: "short" } : { month: "short", day: "numeric" };
  return new Intl.DateTimeFormat(locale(), { ...day, hour: h12 ? "numeric" : "2-digit", minute: "2-digit", hour12: h12 }).format(at);
}

/**
 * Under a window's bar: where the bar ends at the reset if the use goes on as since the window began. Quiet unless the limit
 * would be reached first. Nothing when the setting is off, the card is dimmed (an old reading) or forecast.ts has too little to go on.
 */
export function PaceLine({ w, readAt, error, now }: { w: UsageWindow; readAt: number; error: string | null | undefined; now: number }) {
  const on = settings.use().aiUsage.forecast;
  const p = on && freshReading(error) ? pace(w, readAt, now) : null;
  if (!p) return null;
  const limit = p.kind === "limit";
  const text = limit ? t("In diesem Tempo ist das Limit gegen {time} erreicht", { time: when(p.at, now) }) : t("Im Tempo bei {p} % zum Zurücksetzen", { p: p.percent });
  // One line, or two for the limit time, never more: the panel is made as tall as these lines need (usePaceGrow). The whole text stays in the tooltip.
  return (
    <div title={text} className={`text-caption ${limit ? "line-clamp-2 text-orange" : "truncate text-label-3"}`} style={{ marginTop: GAP_PX }}>
      {text}
    </div>
  );
}

/** Pixels the tallest card gains from its pace lines: the panel grows by that, as it does for a card kept from an old reading. */
export function usePaceGrow(providers: Partial<UsageProvider>[], now: number): number {
  const on = settings.use().aiUsage.forecast;
  if (!on) return 0;
  let most = 0;
  for (const p of providers) {
    if (!freshReading(p.error)) continue;
    let px = 0;
    for (const w of p.windows ?? []) {
      const lines = paceLines(pace(w, p.updatedAt ?? NaN, now));
      if (lines) px += lines * LINE_PX + GAP_PX;
    }
    most = Math.max(most, px);
  }
  return most;
}
