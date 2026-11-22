import { useEffect } from "react";
import { t } from "../../../i18n";
import { createStore } from "../../../lib/store";
import { taskbar } from "../../../platform/services";
import { HardDrives, Plug } from "../../../ui/iconset";
import { diskSize } from "../../system/format";
import { barFeed } from "../barStores";
import { lowSpace, orderDisks, usedShare, type DiskDrive } from "../disks";
import { DISK_ROW } from "../panelModel";
import { away } from "./QuickPage";

/** The drives the open panel lists: the widget's last read as it opens, then its own; null while it is closed. */
export const panelDisks = createStore<DiskDrive[] | null>(null);

/**
 * The disk widget's panel above the bar, sized by DISKS_SIZE: every drive, internal ones first, then the ones that plug in, each with
 * its name, letter, free and total space and a bar filled to its use, red under 10 % free. Read as it opens, since Crest hears no
 * device change; a click opens the drive in File Explorer by its letter, which Rust checks against what it listed.
 */
export function DisksPanel() {
  const list = orderDisks(panelDisks.use() ?? []);
  useEffect(() => {
    let on = true;
    panelDisks.set(barFeed.get().disks);
    void taskbar.disks().then((d) => on && d && panelDisks.set(d));
    return () => {
      on = false;
      panelDisks.set(null);
    };
  }, []);
  if (!list.length) return <p className="flex h-full items-center justify-center px-5 text-center text-caption text-label-3">{t("Wird gelesen …")}</p>;
  return (
    <div className="h-full overflow-y-auto p-2 [scrollbar-width:none]">
      {list.map((d) => {
        const low = lowSpace(d), Icon = d.removable ? Plug : HardDrives;
        const name = d.name || (d.removable ? t("USB-Laufwerk") : t("Lokaler Datenträger"));
        return (
          <button
            key={d.letter}
            onClick={() => away(() => taskbar.diskOpen(d.letter))}
            className="flex w-full items-center gap-3 rounded-[10px] px-3 outline-none hover:bg-fill-1 focus-visible:bg-fill-1 material:rounded-[16px]"
            style={{ height: DISK_ROW }}
          >
            <Icon size={18} weight="regular" className="shrink-0 text-label-2" />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="flex w-full items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-start text-footnote font-medium text-label">{`${name} (${d.letter})`}</span>
                <span className={`tabular shrink-0 text-caption ${low ? "text-red" : "text-label-3"}`}>{t("{free} frei von {total}", { free: diskSize(d.free), total: diskSize(d.total) })}</span>
              </span>
              <span className="relative block h-1.5 overflow-hidden rounded-full bg-fill-2">
                <span className={`absolute inset-y-0 start-0 rounded-full ${low ? "bg-red" : "bg-accent"}`} style={{ width: `${usedShare(d) * 100}%` }} />
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
