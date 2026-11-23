// The notch's sources of the bar's Screen Time and Day timeline widgets, which feed.tsx runs while the widget is on the bar.

import { useEffect, useState } from "react";
import { settings } from "../../settings/store";
import { addDays, startOfDay } from "../calendar/model";
import { calendar } from "../calendar/store";
import { useSlice } from "../taskbar/slice";
import { dayEvents } from "./day";
import { hourTotals, summary } from "./model";
import { screenToday } from "./store";

/** Today's Screen Time in the feed's screenTime slice: the total, the first three apps and the time per hour; null while it is off. */
export function ScreenTimeSource(): null {
  const on = settings.use().screenTime.on;
  const today = screenToday.use();
  useSlice("screenTime", on ? summary(today, 3) : null);
  return null;
}

/**
 * The day's events in the feed's timeline slice, from midnight to tomorrow noon so the next hours late in the evening have tomorrow's
 * morning, without their titles; with Screen Time per hour while it records. Again when the calendar changes and at midnight.
 */
export function TimelineSource(): null {
  const { data } = calendar.use();
  const on = settings.use().screenTime.on;
  const today = screenToday.use();
  const [now, setNow] = useState(Date.now);
  const day = startOfDay(now);
  useEffect(() => {
    // At most an hour at a time, so a clock change or a sleep cannot keep yesterday.
    const id = window.setTimeout(() => setNow(Date.now()), Math.min(3_600_000, addDays(day, 1) - Date.now() + 50));
    return () => window.clearTimeout(id);
  }, [now, day]);
  const events = dayEvents(data, day, addDays(day, 1) + 12 * 3_600_000);
  useSlice("timeline", { events, hours: on && today ? hourTotals(today) : null });
  return null;
}
