// Which of the tray's icons the bar shows and which wait in the panel behind its ^ button. Pure, so the rule is tested alone.

import type { TrayIcon } from "./model.ts";

/** The icons whose id is in `shown`, in the order of `shown` (icons sharing an id stay in their own order), and the rest. */
export function splitTray(icons: TrayIcon[], shown: string[]): { visible: TrayIcon[]; hidden: TrayIcon[] } {
  const ids = new Set(shown);
  return { visible: shown.flatMap((id) => icons.filter((i) => i.id === id)), hidden: icons.filter((i) => !ids.has(i.id)) };
}
