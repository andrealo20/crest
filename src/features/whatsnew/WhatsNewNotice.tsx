import { ArrowCircleUp, Gift, X } from "@phosphor-icons/react";
import { openOn } from "../../notch/nav";
import { NOTICE_BUTTON as BUTTON, NoticeButton } from "../../notch/row/NoticeButton";
import { noticeCard } from "../../notch/row/NoticeCard";
import { t } from "../../i18n";
import type { WhatsNew } from "./model";
import { dismissWhatsNew, opened } from "./store";

/** "Crest 0.3.2" with "What's new" or "Update available" as a card, and dismiss. A click on the text opens the page. */
export function whatsNewNotice(news: NonNullable<WhatsNew>, max: number) {
  const available = news.kind === "available";
  const Icon = available ? ArrowCircleUp : Gift;
  return noticeCard(
    {
      key: `whatsnew:${news.kind}:${news.version}`,
      icon: <Icon size={16} weight="fill" />,
      hue: "violet",
      title: `Crest ${news.version}`,
      text: available ? t("Update verfügbar") : t("Neuerungen"),
      onOpen: () => {
        opened.set(news);
        openOn("whatsnew");
      },
      actionsWidth: BUTTON,
      actions: (
        <NoticeButton label={t("Ausblenden")} onClick={() => dismissWhatsNew(news)}>
          <X size={12} weight="bold" />
        </NoticeButton>
      ),
    },
    max,
  );
}
