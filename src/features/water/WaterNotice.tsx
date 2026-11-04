import { Drop, Plus, X } from "@phosphor-icons/react";
import { openOn } from "../../notch/nav";
import { NOTICE_BUTTON as BUTTON, NoticeButton } from "../../notch/row/NoticeButton";
import { noticeCard } from "../../notch/row/NoticeCard";
import { t } from "../../i18n";
import { todayTotal } from "./water";
import { water, waterActions } from "./store";
import { formatMl } from "./format";

/** The water reminder as a card: "Time to drink", today's amount against the goal, Drink and Later. A click on the text opens Water. */
export function waterNotice(goalMl: number, max: number) {
  const total = todayTotal(water.get().log, Date.now());
  return noticeCard(
    {
      key: "water",
      icon: <Drop size={16} weight="fill" />,
      hue: "cyan",
      title: t("Zeit zu trinken"),
      text: `${formatMl(total)} / ${formatMl(goalMl)}`,
      onOpen: () => openOn("water"),
      actionsWidth: 2 * BUTTON + 6,
      actions: (
        <>
          <NoticeButton label={t("Trinken")} onClick={() => waterActions.drink()}>
            <Plus size={12} weight="bold" />
          </NoticeButton>
          <NoticeButton label={t("Später")} onClick={waterActions.dismiss}>
            <X size={12} weight="bold" />
          </NoticeButton>
        </>
      ),
    },
    max,
  );
}
