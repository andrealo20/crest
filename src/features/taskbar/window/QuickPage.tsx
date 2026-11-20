import type { ReactNode } from "react";
import { CaretLeft } from "../../../ui/iconset";
import { t } from "../../../i18n";
import { closePanel, quickPage } from "../panel";
import { holdBriefly } from "./hold";

/** A Windows surface comes to the front: the panel goes and the bar stays up meanwhile. */
export function away(open: () => Promise<void>): void {
  closePanel();
  holdBriefly();
  void open().catch(() => {});
}

/**
 * A page inside the quick panel, sized by QUICK_PAGE_SIZE: a header with the way back to the main page, its title and its `actions`,
 * the rows (scrolling past PAGE_MAX_ROWS), and a footer with what went wrong and a button to Windows' Settings.
 */
export function QuickPageFrame({ title, actions, note, footer, children }: { title: string; actions?: ReactNode; note: string | null; footer: { label: string; onClick: () => void }; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <div className="flex h-8 shrink-0 items-center gap-2">
        <button
          aria-label={t("Zurück zu den Schnelleinstellungen")}
          title={t("Zurück zu den Schnelleinstellungen")}
          onClick={() => quickPage.set(null)}
          className="pressable flex size-8 shrink-0 items-center justify-center rounded-full text-label-2 hover:bg-fill-2 hover:text-label"
        >
          <CaretLeft size={16} weight="regular" className="rtl:-scale-x-100" />
        </button>
        <span className="min-w-0 flex-1 truncate text-footnote font-semibold text-label">{title}</span>
        {actions}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">{children}</div>
      <div className="flex h-8 shrink-0 items-center gap-2">
        <span role="status" className="min-w-0 flex-1 truncate ps-1 text-caption text-label-3">
          {note}
        </span>
        <button onClick={footer.onClick} className="pressable shrink-0 rounded-full px-2.5 py-1 text-footnote font-medium text-label-2 hover:bg-fill-2 hover:text-label">
          {footer.label}
        </button>
      </div>
    </div>
  );
}
