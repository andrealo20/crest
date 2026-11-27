import { useEffect, useRef } from "react";
import { t } from "../../../i18n";
import { formatBytes } from "../../../lib/format";
import { taskbar } from "../../../platform/services";
import { Trash } from "../../../ui/iconset";
import { emptyWarning } from "../model";
import { closePanel } from "../panel";
import { recycleBin } from "../store";
import { holdBriefly } from "./hold";

/** The warning's id, which the panel's dialog is described by (BarPanel), so a screen reader reads it with the title. */
export const RECYCLE_WARNING_ID = "bar-panel-recycle-warning";

/** "Frees 22.3 MB", the size in bold wherever the language puts it. */
function Frees({ bytes }: { bytes: number }) {
  const [before, after = ""] = t("Gibt {size} frei", { size: "\u0000" }).split("\u0000");
  return (
    <div className="text-body text-label-2">
      {before}
      <span className="font-semibold text-label">{formatBytes(bytes)}</span>
      {after}
    </div>
  );
}

/**
 * The Recycle Bin's confirmation above the bar, opened by its button and by Empty in its menu: the bin in a red circle, how much
 * emptying frees and how many items go for good, a link that opens it in Explorer, and its two buttons. The red one alone empties
 * it (recycle.rs asks Windows nothing more); it is off while the bin is empty or not counted yet. The count follows the bin while
 * the panel is open.
 */
export function RecyclePanel({ focus }: { focus?: boolean }) {
  const bin = recycleBin.use();
  const cancel = useRef<HTMLButtonElement>(null);
  // Read again as it opens: a change Windows did not report (#107) would leave the count the bar had.
  useEffect(() => {
    void taskbar.recycle(true).then((r) => r && recycleBin.set(r), () => {});
  }, []);
  // Opened by the keyboard or from the bin's menu: the keyboard lands on Cancel, the safe answer, as a confirmation does.
  useEffect(() => {
    if (focus) cancel.current?.focus({ preventScroll: true });
  }, [focus]);
  const items = bin?.items ?? 0;
  const run = (action: "open" | "empty") => () => {
    closePanel();
    holdBriefly();
    void taskbar.recycleDo(action).catch(() => {});
  };
  const [warning, values] = emptyWarning(bin?.items ?? null);
  return (
    <div className="flex h-full flex-col p-6">
      <div className="flex items-center gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-red/15 text-red">
          <Trash size={26} weight="regular" />
        </span>
        <div className="min-w-0">
          <div className="line-clamp-2 text-title font-semibold text-label">{items ? t("Papierkorb leeren?") : t("Papierkorb")}</div>
          {items > 0 && <Frees bytes={bin?.bytes ?? 0} />}
        </div>
      </div>
      <p id={RECYCLE_WARNING_ID} className="mt-4 text-body text-label-2">
        {t(warning, values)}
      </p>
      <button onClick={run("open")} className="pressable mt-2 self-start text-footnote font-medium text-accent hover:underline material:text-primary">
        {t("Im Datei-Explorer öffnen")}
      </button>
      <div className="mt-auto flex flex-col gap-2">
        <button
          onClick={run("empty")}
          disabled={!items}
          className="pressable h-11 rounded-[14px] bg-red text-body font-semibold text-notch disabled:opacity-40 material:rounded-full"
        >
          {t("Papierkorb leeren")}
        </button>
        <button ref={cancel} onClick={closePanel} className="pressable pressable-fill h-11 rounded-[14px] bg-fill-2 text-body font-semibold text-label material:rounded-full">
          {t("Abbrechen")}
        </button>
      </div>
    </div>
  );
}
