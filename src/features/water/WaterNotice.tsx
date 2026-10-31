import type { ReactNode } from "react";
import { Drop, Plus, X } from "@phosphor-icons/react";
import { navigate } from "../../notch/nav";
import { measureText } from "../../notch/row/measure";
import { Marquee } from "../../notch/row/Marquee";
import { NoticeButton } from "../todos/ReminderNotice";
import { t } from "../../i18n";
import { todayTotal } from "./water";
import { water, waterActions } from "./store";
import { formatMl } from "./format";

const ICON = 17, GAP = 6, BUTTON = 22;

/** "Time to drink · 750 / 2,000 ml" with Drink and dismiss, for the closed notch. */
export function waterNotice(goalMl: number): { width: number; key: string; body: ReactNode } {
  const total = todayTotal(water.get().log, Date.now());
  const text = `${t("Zeit zu trinken")} · ${formatMl(total)} / ${formatMl(goalMl)}`;
  const textW = measureText(text);
  return {
    width: ICON + textW + 2 * BUTTON + 4 * GAP,
    key: "water",
    body: (
      <span className="flex h-full items-center" style={{ gap: GAP }}>
        <button className="pointer-events-auto flex h-full items-center" style={{ gap: GAP }} onClick={() => navigate("water")}>
          <Drop size={ICON} weight="fill" style={{ color: "var(--color-link)" }} />
          <Marquee text={text} textWidth={textW} width={textW} paused={false} once />
        </button>
        <NoticeButton label={t("Trinken")} onClick={() => waterActions.drink()}>
          <Plus size={12} weight="bold" />
        </NoticeButton>
        <NoticeButton label={t("Später")} onClick={waterActions.dismiss}>
          <X size={12} weight="bold" />
        </NoticeButton>
      </span>
    ),
  };
}
