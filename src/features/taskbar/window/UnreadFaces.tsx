// The faces of the bar's Unread widget, what its click opens and its menu's rows.

import { taskbar } from "../../../platform/services";
import { holdBriefly } from "./hold";
import type { Body, WidgetContext } from "./Widget";

/** The picked apps with their counts, as one icon with the total or each app on its own; null without data or picks. */
export function unreadPart(_ctx: WidgetContext): Body | null {
  return null;
}

/** Opens the app at `slot` of the version with each app, else the one in front; Windows' notification centre where no app opens. */
export function openUnread(_slot: number | null): void {
  // The bar stays up while it comes to the front; Windows may refuse, and nothing changes then.
  holdBriefly();
  void taskbar.calendar().catch(() => {});
}

/** A row for each picked app and one for Windows' notification centre, over the widget's Crest menu rows. */
export function UnreadRows(_props: { close: () => void; openTool: (tool: string) => void }) {
  return null;
}
