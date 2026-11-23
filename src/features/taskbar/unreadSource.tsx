// The notch's source of the bar's Unread widget, which feed.tsx runs while the widget is on the bar.

import { settings } from "../../settings/store";
import { waiting } from "../notices/store";
import { useSlice } from "./slice";
import { unreadApps } from "./unread";

/**
 * The picked apps with their notifications in Windows' notification centre, in the feed's unread slice; null while Windows is not read.
 * It reads what Live notices already holds, and only the picked apps go to the bar, never the whole map.
 */
export function UnreadSource(): null {
  const { taskbar, notices } = settings.use();
  const counts = waiting.use();
  useSlice("unread", unreadApps(taskbar.unread, notices.apps, notices.enabled && notices.windows ? counts : null));
  return null;
}
