import { t } from "../../../i18n";
import { formatBytes } from "../../../lib/format";
import { taskbar } from "../../../platform/services";
import { Trash } from "../../../ui/iconset";
import { emptyWarning } from "../model";
import { closePanel } from "../panel";
import { recycleBin } from "../store";
import { holdBriefly } from "./hold";

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
export function RecyclePanel() {
  const bin = recycleBin.use();
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
          <div className="truncate text-title font-semibold text-label">{items ? t("Papierkorb leeren?") : t("Papierkorb")}</div>
          {items > 0 && <Frees bytes={bin?.bytes ?? 0} />}
        </div>
      </div>
      <p className="mt-4 text-body text-label-2">{t(warning, values)}</p>
      <button onClick={run("open")} className="pressable mt-2 self-start text-footnote font-medium text-accent hover:underline material:text-primary">
        {t("Im Datei-Explorer öffnen")}
      </button>
      <div className="mt-auto flex flex-col gap-2">
        <button
          onClick={run("empty")}
          disabled={!items}
          className="pressable h-11 rounded-[14px] bg-red text-body font-semibold text-white disabled:opacity-40 material:rounded-full"
        >
          {t("Papierkorb leeren")}
        </button>
        <button onClick={closePanel} className="pressable pressable-fill h-11 rounded-[14px] bg-fill-2 text-body font-semibold text-label material:rounded-full">
          {t("Abbrechen")}
        </button>
      </div>
    </div>
  );
}
