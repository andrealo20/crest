import { useEffect, type ReactNode } from "react";
import { motion } from "motion/react";
import { spin } from "../../../design/motion";
import { t } from "../../../i18n";
import { createStore } from "../../../lib/store";
import { taskbar } from "../../../platform/services";
import { CircleNotch, Folder, HardDrives, MagnifyingGlass, Plug } from "../../../ui/iconset";
import { diskSize } from "../../system/format";
import { barFeed } from "../barStores";
import { freshScan, lowSpace, orderDisks, scanProgress, scanRows, scanning, usedShare, type DiskDrive, type ScanLevel, type ScanState } from "../disks";
import { DISK_ROW } from "../panelModel";
import { QuickPageFrame, away } from "./QuickPage";

/** The drives the open panel lists: the widget's last read as it opens, then its own; null while it is closed. */
export const panelDisks = createStore<DiskDrive[] | null>(null);

/**
 * The scan page the panel shows in place of the drives; null for the drives. Kept while the panel is closed, so a scan goes on and
 * its answer waits, and in memory only.
 */
export const diskScan = createStore<ScanState | null>(null);

/** As the disk panel opens: a scan's answer past SCAN_FRESH goes. Once here, so the panel's size and its page never disagree on it. */
export function dropStaleScan(): void {
  if (!freshScan(diskScan.get(), Date.now())) diskScan.set(null);
}

/**
 * Scans `level` of the drive `letter` on top of the levels `below` it. Its progress, its answer and what went wrong land in the
 * store whether the panel is open or not, and only while the level is still on the page.
 */
function scanLevel(letter: string, below: ScanLevel[], level: Pick<ScanLevel, "folder" | "title" | "of">, fresh: boolean): void {
  const token = Math.floor(Math.random() * 2 ** 52) + 1;
  diskScan.set({ letter, at: Date.now(), levels: [...below, { ...level, token, counted: 0, scan: null, error: null }] });
  const patch = (p: Partial<ScanLevel>) => {
    const s = diskScan.get();
    if (s?.levels.some((l) => l.token === token)) diskScan.set({ ...s, at: Date.now(), levels: s.levels.map((l) => (l.token === token ? { ...l, ...p } : l)) });
  };
  const off = taskbar.onDiskScan((counted) => patch({ counted }));
  void taskbar.diskScan(letter, level.folder, token, fresh).then((r) => {
    off();
    patch(typeof r === "string" ? { error: r } : { scan: r });
  });
}

const top = (s: ScanState) => s.levels[s.levels.length - 1];

/** Back up a level, stopping its scan; from a drive's root to the drives, which drops the scan. */
function back(): void {
  const s = diskScan.get();
  if (!s) return;
  if (scanning(top(s))) void taskbar.diskScanStop(top(s).token);
  diskScan.set(s.levels.length > 1 ? { ...s, levels: s.levels.slice(0, -1) } : null);
}

/** The level on top walked again. */
function rescan(): void {
  const s = diskScan.get();
  if (s) scanLevel(s.letter, s.levels.slice(0, -1), top(s), true);
}

/**
 * The disk widget's panel above the bar, sized by DISKS_SIZE: every drive, internal ones first, then the ones that plug in, each with
 * its name, letter, free and total space and a bar filled to its use, red under 10 % free. Read as it opens, since Crest hears no
 * device change; a click opens the drive in File Explorer by its letter, which Rust checks against what it listed, and its Scan now
 * opens a scan's page in its place.
 */
export function DisksPanel() {
  const list = orderDisks(panelDisks.use() ?? []);
  const scan = diskScan.use();
  useEffect(() => {
    let on = true;
    panelDisks.set(barFeed.get().disks);
    void taskbar.disks().then((d) => on && d && panelDisks.set(d));
    return () => {
      on = false;
      panelDisks.set(null);
    };
  }, []);
  if (scan) return <ScanPage state={scan} />;
  if (!list.length) return <p className="flex h-full items-center justify-center px-5 text-center text-caption text-label-3">{t("Wird gelesen …")}</p>;
  return (
    <div className="h-full overflow-y-auto p-2 [scrollbar-width:none]">
      {list.map((d) => {
        const Icon = d.removable ? Plug : HardDrives;
        const name = `${d.name || (d.removable ? t("USB-Laufwerk") : t("Lokaler Datenträger"))} (${d.letter})`;
        return (
          <DiskRow
            key={d.letter}
            icon={<Icon size={18} weight="regular" />}
            name={name}
            detail={t("{free} frei von {total}", { free: diskSize(d.free), total: diskSize(d.total) })}
            share={usedShare(d)}
            low={lowSpace(d)}
            onOpen={() => away(() => taskbar.diskOpen(d.letter))}
            onScan={() => scanLevel(d.letter, [], { folder: null, title: name, of: Math.max(d.total - Math.max(d.free, 0), 0) }, true)}
          />
        );
      })}
    </div>
  );
}

/**
 * A scan's page in the quick pages' frame: the way back up a level, the level's title, its progress, its rows or what went wrong,
 * and the footer's note that the answer is partial, with Stop while it runs and Rescan after. Another bar's scan running is said
 * so, and its Stop ends that one and starts this. A folder's row opens it in File Explorer, and its Scan now goes a level down.
 */
function ScanPage({ state }: { state: ScanState }) {
  const { letter, levels } = state;
  const level = top(state);
  const up = levels.length > 1 ? levels[levels.length - 2].title : t("Speicherplatz");
  const running = scanning(level);
  const footer = running
    ? { label: t("Stopp"), onClick: () => void taskbar.diskScanStop(level.token) }
    : level.error === "busy"
      ? { label: t("Stopp"), onClick: () => void taskbar.diskScanStop().then(rescan) }
      : { label: t("Neu einlesen"), onClick: rescan };
  return (
    <QuickPageFrame
      title={level.title}
      back={{ label: t("Zurück zu {name}", { name: up }), onClick: back }}
      note={level.scan?.partial ? t("Scan vorzeitig beendet, nur ein Teil gezählt") : null}
      footer={footer}
    >
      {running ? (
        <DiskRow
          icon={
            <motion.span className="flex" animate={{ rotate: 360 }} transition={spin}>
              <CircleNotch size={18} weight="regular" />
            </motion.span>
          }
          name={t("Wird gelesen …")}
          detail={diskSize(level.counted)}
          share={scanProgress(level.counted, level.of)}
        />
      ) : level.scan ? (
        scanRows(level.scan, level.of, level.folder === null).map((r) => {
          const f = r.folder;
          if (!f)
            return (
              <DiskRow
                key={r.kind}
                icon={null}
                name={r.kind === "more" ? t("Weitere Ordner") : r.kind === "files" ? t("Dateien") : t("System und nicht lesbar")}
                // Hard links and what Windows keeps from Crest blur it: an estimate.
                detail={r.kind === "other" ? `≈ ${diskSize(r.size)}` : diskSize(r.size)}
                share={r.share}
              />
            );
          return (
            <DiskRow
              key={f.id}
              icon={<Folder size={18} weight="regular" />}
              name={f.name}
              detail={diskSize(r.size)}
              share={r.share}
              title={t("Ordner öffnen")}
              onOpen={() => away(() => taskbar.diskOpen(letter, f.id))}
              onScan={() => scanLevel(letter, levels, { folder: f.id, title: f.name, of: f.size }, false)}
            />
          );
        })
      ) : (
        <p className="flex h-full items-center justify-center px-5 text-center text-caption text-label-3">
          {level.error === "busy" ? t("Es läuft schon ein Scan") : t("Das hat nicht geklappt")}
        </p>
      )}
    </QuickPageFrame>
  );
}

/**
 * A row of the disk panel, DISK_ROW tall: its icon, its name over a bar filled to `share` with `detail` beside it, red when `low`.
 * With `onOpen` the row is a button, and with `onScan` a round Scan now sits at its end. The detail sits by the bar, so the name
 * keeps the row's width and the button cuts it short no more than before.
 */
function DiskRow({ icon, name, detail, share, low = false, title, onOpen, onScan }: { icon: ReactNode; name: string; detail: string; share: number; low?: boolean; title?: string; onOpen?: () => void; onScan?: () => void }) {
  const body = (
    <>
      <span className="flex w-[18px] shrink-0 justify-center text-label-2">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="truncate text-start text-footnote font-medium text-label">{name}</span>
        <span className="flex w-full items-center gap-2">
          <span className="relative block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-fill-2">
            <span className={`absolute inset-y-0 start-0 rounded-full ${low ? "bg-red" : "bg-accent"}`} style={{ width: `${share * 100}%` }} />
          </span>
          <span className={`tabular shrink-0 text-caption ${low ? "text-red" : "text-label-3"}`}>{detail}</span>
        </span>
      </span>
    </>
  );
  return (
    <div className={`flex items-center gap-1 rounded-[10px] pe-1 material:rounded-[16px] ${onOpen ? "hover:bg-fill-1 has-[:focus-visible]:bg-fill-1" : ""}`} style={{ height: DISK_ROW }}>
      {onOpen ? (
        <button title={title} onClick={onOpen} className="flex h-full min-w-0 flex-1 items-center gap-3 ps-3 outline-none">
          {body}
        </button>
      ) : (
        <span className="flex h-full min-w-0 flex-1 items-center gap-3 ps-3">{body}</span>
      )}
      {onScan ? (
        <button
          aria-label={t("Jetzt scannen")}
          title={t("Jetzt scannen")}
          onClick={onScan}
          className="pressable flex size-8 shrink-0 items-center justify-center rounded-full text-label-2 outline-none hover:bg-fill-2 hover:text-label focus-visible:bg-fill-2 focus-visible:text-label"
        >
          <MagnifyingGlass size={16} weight="regular" />
        </button>
      ) : (
        <span className="size-8 shrink-0" />
      )}
    </div>
  );
}
