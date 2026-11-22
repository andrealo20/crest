// The rules of the bar's Top apps widget. Pure, so they can be tested without the app around them.

import type { ProcReading } from "../../platform/services.ts";

/** An app as the Top apps widget draws it: its share of the machine in percent, by CPU or by memory, and its memory in bytes. */
export interface TopApp {
  id: string;
  name: string;
  path: string | null;
  share: number;
  mem: number;
}

/** One app of the Hardware tool's list as the widget reads it, by memory with `ram`; null while it has nothing to show. */
export function topApp(_p: ProcReading, _ram: boolean, _memTotal: number, _cores: number): TopApp | null {
  return null;
}
