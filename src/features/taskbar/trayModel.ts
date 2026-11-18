// Which of the tray's icons the bar shows and which wait in the panel behind its ^ button, and how a drag changes that. Pure, so the
// rules are tested alone.

import type { TrayIcon } from "./model.ts";

/** The icons whose id is in `shown`, in the order of `shown` (icons sharing an id stay in their own order), and the rest. */
export function splitTray(icons: TrayIcon[], shown: string[]): { visible: TrayIcon[]; hidden: TrayIcon[] } {
  const ids = new Set(shown);
  return { visible: shown.flatMap((id) => icons.filter((i) => i.id === id)), hidden: icons.filter((i) => !ids.has(i.id)) };
}

/**
 * `shown` with `id` at `slot`: a kept id moves there, counting its own place as the bar shows it, so a slot right before or right
 * after it leaves the order as it is; a new one goes in.
 */
export function promote(shown: string[], id: string, slot: number): string[] {
  const from = shown.indexOf(id);
  const next = shown.filter((s) => s !== id);
  next.splice(from >= 0 && slot > from ? slot - 1 : slot, 0, id);
  return next;
}

/** `shown` without `id`: its icons go to the panel. */
export const demote = (shown: string[], id: string): string[] => shown.filter((s) => s !== id);

/** The place in `shown` of the gap before the bar's `slot`-th icon (`visible`, as splitTray gives it), the end for the gap after the last. */
export const shownSlot = (shown: string[], visible: TrayIcon[], slot: number): number => (slot < visible.length ? shown.indexOf(visible[slot].id) : shown.length);
