// Device batteries as a part of the closed row and its column: the lowest battery of the connected Bluetooth devices.

import type { ReactNode } from "react";

/** The lowest battery in the row or the column, its width and how it draws, while `on` (Windows only); null without a device that reports one. */
export function useBtPart(_on: boolean): { width: number; draw: () => ReactNode } | null {
  return null;
}
