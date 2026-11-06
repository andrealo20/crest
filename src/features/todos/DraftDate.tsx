import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Clock, X } from "@phosphor-icons/react";
import { springs } from "../../design/motion";
import { formatTime } from "../../lib/format";
import { locale, t } from "../../i18n";
import { settings } from "../../settings/store";
import { parseDate } from "./dates";
import { dayDiff } from "./schedule";

/**
 * The date found in the text of a new task ("call Marco tomorrow 9am") and what Enter does with it. It is only
 * a suggestion: the chip under the field shows it, and the words leave the title and the task gets the time
 * only if the chip is still there when the task is added. Dismissed, the task is exactly what was typed.
 */
export function useDraftDate(draft: string, now: number) {
  const on = settings.use().productivity.nlDates !== false;
  const [dismissed, setDismissed] = useState("");
  const found = useMemo(() => (on ? parseDate(draft, now) : null), [on, draft, now]);
  // A new task starts without dismissals.
  useEffect(() => {
    if (!draft) setDismissed("");
  }, [draft]);
  const phrase = found?.phrase.toLowerCase() ?? "";
  // A dismissal holds while the phrase grows or shrinks as it is typed ("tomorrow", "tomorrow 9am").
  const shown = found && !(dismissed && (phrase.startsWith(dismissed) || dismissed.startsWith(phrase))) ? found : null;
  return {
    shown,
    dismiss: () => setDismissed(phrase),
    /** Title and due time for the task `text`. */
    apply: (text: string): { text: string; due: number | null } => (shown ? { text: shown.title, due: shown.due } : { text, due: null }),
  };
}

/** "Today 5:00 pm", "Tomorrow 9:00 am", "Fri 5:00 pm", "2 Dec 9:00 am", "2 Dec 2027 9:00 am". */
function dueWhen(due: number, now: number): string {
  const d = dayDiff(now, due);
  const time = formatTime(due);
  if (d === 0) return `${t("Heute")} ${time}`;
  if (d === 1) return `${t("Morgen")} ${time}`;
  if (d > 1 && d < 7) return `${new Intl.DateTimeFormat(locale(), { weekday: "short" }).format(due)} ${time}`;
  const sameYear = new Date(due).getFullYear() === new Date(now).getFullYear();
  return `${new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(due)} ${time}`;
}

/** The chip under the new-task field. */
export function DateChip({ date, now }: { date: ReturnType<typeof useDraftDate>; now: number }) {
  const found = date.shown;
  return (
    <div aria-live="polite">
      <AnimatePresence initial={false}>
        {found && (
          <motion.div
            key="date-chip"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 26 }}
            exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }}
            transition={springs.snappy}
            className="overflow-hidden"
          >
            <div className="flex ps-1 pt-1.5">
              <span className="inline-flex h-5 items-center gap-1 rounded-full bg-fill-1 ps-2 pe-0.5 text-caption text-label-2">
                <Clock size={11} weight="bold" />
                <span className="tabular">{t("Fällig {when}", { when: dueWhen(found.due, now) })}</span>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()} // keeps the cursor in the field
                  onClick={date.dismiss}
                  aria-label={t("Datum verwerfen")}
                  title={t("Datum verwerfen")}
                  className="pressable flex size-4 items-center justify-center rounded-full text-label-3 hover:text-label"
                >
                  <X size={10} weight="bold" />
                </button>
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
