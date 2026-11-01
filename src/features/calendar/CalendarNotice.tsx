import type { ReactNode } from "react";
import { CalendarBlank, X } from "@phosphor-icons/react";
import { formatTime } from "../../lib/format";
import { openOn } from "../../notch/nav";
import { measureText } from "../../notch/row/measure";
import { Marquee } from "../../notch/row/Marquee";
import { NOTICE_BUTTON as BUTTON, NoticeButton } from "../../notch/row/NoticeButton";
import type { CalendarEvent } from "../../platform/services";
import { t } from "../../i18n";
import { calendar, dismissCalendarNotice } from "./store";

const ICON = 17, GAP = 6, TEXT_MAX = 280;

/** "14:30 · Standup" with a dismiss button, for the closed notch. A click on the text opens the Calendar. */
export function calendarNotice(e: CalendarEvent): { width: number; key: string; body: ReactNode } {
  const color = calendar.get().data?.calendars.find((c) => c.id === e.calendar)?.color || "var(--color-link)";
  const text = `${formatTime(e.start)} · ${e.title || t("(Ohne Titel)")}`;
  const textW = measureText(text), shown = Math.min(textW, TEXT_MAX);
  return {
    width: ICON + shown + BUTTON + 3 * GAP,
    key: `calendar:${e.id}`,
    body: (
      <span className="flex h-full items-center" style={{ gap: GAP }}>
        {/* Not stopped: the click also opens the notch, on the Calendar. */}
        <button className="pointer-events-auto flex h-full items-center" style={{ gap: GAP }} onClick={() => openOn("calendar")}>
          <CalendarBlank size={ICON} weight="fill" style={{ color }} />
          <Marquee text={text} textWidth={textW} width={shown} paused={false} once />
        </button>
        <NoticeButton label={t("Ausblenden")} onClick={() => dismissCalendarNotice(e.id)}>
          <X size={12} weight="bold" />
        </NoticeButton>
      </span>
    ),
  };
}
