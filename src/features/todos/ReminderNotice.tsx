import { motion } from "motion/react";
import { AlarmIcon, Check, ClockClockwise } from "@phosphor-icons/react";
import { pulse } from "../../design/motion";
import { openOn } from "../../notch/nav";
import { NOTICE_BUTTON as BUTTON, NoticeButton } from "../../notch/row/NoticeButton";
import { noticeCard } from "../../notch/row/NoticeCard";
import { t } from "../../i18n";
import { todoActions } from "./store";
import type { Task } from "./model";

/** A due to-do as a card: the task, "Time's up", snooze and done. A click on the text opens the To-dos. */
export function reminderNotice(due: Task[], max: number) {
  const task = due[0];
  const more = due.length > 1 ? ` · ${t("+{n} weitere", { n: due.length - 1 })}` : "";
  return noticeCard(
    {
      key: `reminder:${task.id}:${task.alertAt}`,
      icon: (
        <motion.span className="flex" animate={{ opacity: [1, 0.45] }} transition={{ ...pulse, repeat: 5 }}>
          <AlarmIcon size={16} weight="fill" />
        </motion.span>
      ),
      hue: "orange",
      title: task.text,
      text: t("Zeit ist um") + more,
      onOpen: () => openOn("todos"),
      actionsWidth: 2 * BUTTON + 6,
      actions: (
        <>
          <NoticeButton label={t("10 Min. später")} onClick={() => todoActions.snooze(task.id)}>
            <ClockClockwise size={12} weight="bold" />
          </NoticeButton>
          <NoticeButton label={t("Erledigt")} onClick={() => todoActions.done(task.id)}>
            <Check size={12} weight="bold" />
          </NoticeButton>
        </>
      ),
    },
    max,
  );
}
