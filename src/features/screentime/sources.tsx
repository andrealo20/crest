// The notch's sources of the bar's Screen Time and Day timeline widgets, which feed.tsx runs while the widget is on the bar.

/** Today's Screen Time in the feed's screenTime slice: the total, the first three apps and the time per hour; null while it is off. */
export function ScreenTimeSource(): null {
  return null;
}

/** The day's events in the feed's timeline slice, with Screen Time per hour while it records. */
export function TimelineSource(): null {
  return null;
}
