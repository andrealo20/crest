import { CalendarBlank, VideoCamera, X } from "@phosphor-icons/react";
import { formatTime } from "../../lib/format";
import { openOn } from "../../notch/nav";
import { NOTICE_BUTTON as BUTTON, NoticeButton } from "../../notch/row/NoticeButton";
import { noticeCard } from "../../notch/row/NoticeCard";
import type { CalendarEvent } from "../../platform/services";
import { t } from "../../i18n";
import { meetingLink } from "./model";
import { dismissCalendarNotice, joinMeeting } from "./store";

/** The event about to start as a card: its title, the time, Join (online meetings) and dismiss. A click on the text opens the Calendar. */
export function calendarNotice(e: CalendarEvent, max: number) {
  const link = meetingLink(e);
  return noticeCard(
    {
      key: `calendar:${e.id}`,
      icon: <CalendarBlank size={16} weight="fill" />,
      hue: "red",
      title: e.title || t("(Ohne Titel)"),
      text: formatTime(e.start),
      onOpen: () => openOn("calendar"),
      actionsWidth: link ? 2 * BUTTON + 6 : BUTTON,
      actions: (
        <>
          {link && (
            <NoticeButton label={t("Beitreten")} onClick={() => joinMeeting(e.id, link)}>
              <VideoCamera size={12} weight="fill" />
            </NoticeButton>
          )}
          <NoticeButton label={t("Ausblenden")} onClick={() => dismissCalendarNotice(e.id)}>
            <X size={12} weight="bold" />
          </NoticeButton>
        </>
      ),
    },
    max,
  );
}
