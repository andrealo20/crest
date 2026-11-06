import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { measureText } from "../../notch/row/measure";
import { NOTICE_BUTTON_PAD, NoticeButton } from "../../notch/row/NoticeButton";
import { noticeSource } from "../../platform/services";

const LABEL_MAX = 110, SHOW_MS = 1600;

/** The label reads "Copy code", then "Copied" (or "Copy failed") for a moment after the click. The code is only held by the click handler, never logged or stored. */
function useCopyCode(code: string) {
  const [done, setDone] = useState<"copied" | "failed" | null>(null);
  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => setDone(null), SHOW_MS);
    return () => window.clearTimeout(id);
  }, [done]);
  const copy = async () => {
    try {
      await noticeSource.copyCode(code);
      setDone("copied");
    } catch {
      setDone("failed");
    }
  };
  return { label: done === "copied" ? t("Kopiert") : done === "failed" ? t("Kopieren fehlgeschlagen") : t("Code kopieren"), copy };
}

const labels = () => [t("Code kopieren"), t("Kopiert"), t("Kopieren fehlgeschlagen")];

/** Width of the card's button: the widest of its three labels, so the card does not change size when the label does. */
export const copyCodeWidth = () => Math.min(LABEL_MAX, Math.max(...labels().map((l) => measureText(l)))) + 2 * NOTICE_BUTTON_PAD;

/** The button on a notice's card in the closed notch. */
export function CopyCodeButton({ code }: { code: string }) {
  const { label, copy } = useCopyCode(code);
  return (
    <NoticeButton wide label={label} onClick={() => void copy()}>
      <span className="truncate text-center text-footnote font-medium" style={{ width: copyCodeWidth() - 2 * NOTICE_BUTTON_PAD }} aria-live="polite">{label}</span>
    </NoticeButton>
  );
}

/** The same on a row of the Notices page, under the text. */
export function CopyCodePill({ code }: { code: string }) {
  const { label, copy } = useCopyCode(code);
  return (
    <button
      className="pressable mt-1 inline-flex h-5 max-w-full items-center rounded-full bg-fill-2 px-2 text-caption font-medium text-label hover:bg-fill-3"
      // The row around it opens the app on a click or Enter.
      onClick={(e) => {
        e.stopPropagation();
        void copy();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span className="min-w-0 truncate" aria-live="polite">{label}</span>
    </button>
  );
}
