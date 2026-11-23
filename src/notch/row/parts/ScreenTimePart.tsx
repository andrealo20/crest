// Screen Time and the Day timeline as parts of the closed row.

import type { ReactNode } from "react";

/** Today's Screen Time in the row, its width and how it draws, while `on` and while it records; null otherwise. */
export function useScreenTimePart(_on: boolean): { width: number; draw: () => ReactNode } | null {
  return null;
}

/** The day's strip in the row, always the whole day, its width and how it draws, while `on`; null otherwise. */
export function useDayPart(_on: boolean): { width: number; draw: () => ReactNode } | null {
  return null;
}
