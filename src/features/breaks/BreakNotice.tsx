import { Coffee, Eye } from "@phosphor-icons/react";
import { NOTICE_BUTTON_PAD as PAD, NoticeButton } from "../../notch/row/NoticeButton";
import { noticeCard } from "../../notch/row/NoticeCard";
import { measureText } from "../../notch/row/measure";
import { t } from "../../i18n";
import { useSecondTick } from "../timer/store";
import { formatLeft, secondsLeft, type ShownBreak } from "./breaks";
import { breaksActions } from "./store";

const LABEL_MAX = 110;

/** The long break's suggestions, one after the other. */
const tips = () => [
  t("Arme und Schultern strecken"),
  t("Ein Glas Wasser trinken"),
  t("Aus dem Fenster schauen"),
  t("Ein paar Schritte gehen"),
  t("Aufstehen und die Beine strecken"),
];

/** The time left, counting down once a second. Its width is fixed by the caller, so the buttons beside it hold still. */
function Countdown({ endsAt, width }: { endsAt: number; width: number }) {
  const now = useSecondTick(true, endsAt % 1000);
  return (
    <span className="tabular shrink-0 text-end text-footnote font-medium text-label-2" style={{ width }}>
      {formatLeft(secondsLeft(endsAt, now))}
    </span>
  );
}

/**
 * A break as a card in the closed notch: the eye break's "look 20 feet away" or the long break's suggestion, the time left, and Skip and
 * Snooze. It goes by itself when the time is up (store.ts), so there is nothing to close.
 */
export function breaksNotice(b: ShownBreak, max: number) {
  const long = b.kind === "long";
  const list = tips();
  const skipLabel = t("Überspringen"), snoozeLabel = t("5 Min. später");
  const pill = (label: string) => Math.min(LABEL_MAX, measureText(label)) + 2 * PAD;
  // Measured with zeros so the width does not change as the digits do.
  const timeW = measureText(formatLeft(Math.round((b.endsAt - b.startedAt) / 1000)).replace(/\d/g, "0"));
  const label = (text: string) => <span className="truncate text-footnote font-medium" style={{ maxWidth: LABEL_MAX }}>{text}</span>;
  return noticeCard(
    {
      key: `breaks:${b.startedAt}`,
      icon: long ? <Coffee size={16} weight="fill" /> : <Eye size={16} weight="fill" />,
      hue: "teal",
      // The instruction is the title in both: it is the widest line, and the title is measured exactly (the caption line is not: its letter spacing).
      title: long ? list[b.tip % list.length] : t("Schau auf etwas in 6 Metern Entfernung"),
      text: long ? t("Zeit für eine Pause") : t("Lass die Augen kurz ausruhen"),
      actionsWidth: timeW + pill(skipLabel) + pill(snoozeLabel) + 12,
      actions: (
        <>
          <Countdown endsAt={b.endsAt} width={timeW} />
          <NoticeButton wide label={skipLabel} onClick={breaksActions.skip}>
            {label(skipLabel)}
          </NoticeButton>
          <NoticeButton wide label={snoozeLabel} onClick={breaksActions.snooze}>
            {label(snoozeLabel)}
          </NoticeButton>
        </>
      ),
    },
    max,
  );
}
