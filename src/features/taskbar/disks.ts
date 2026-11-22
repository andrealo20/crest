// The bar's disk space widget: which drives it draws for its version, in what order the panel lists them, and when one is low on
// room. Pure, so the rules are tested without the app around them.

import type { WidgetVariants } from "./model.ts";

/** A lettered drive as Rust lists it (taskbar/disks.rs, system/hw.rs `BarDrive`). */
export interface DiskDrive {
  letter: string;
  /** The volume's label, else the drive's model; may be empty. */
  name: string;
  total: number;
  free: number;
  /** A USB stick, a card or a USB disk. */
  removable: boolean;
  /** The drive Windows runs from. */
  system: boolean;
}

/** A drive with less than this share free shows red. */
export const LOW_FREE = 0.1;

/** The share of the drive in use, 0 to 1; 0 for a drive that reports no size. */
export const usedShare = (d: DiskDrive): number => (d.total > 0 ? 1 - Math.min(Math.max(d.free, 0), d.total) / d.total : 0);

/** Under LOW_FREE free. */
export const lowSpace = (d: DiskDrive): boolean => d.total > 0 && Math.min(Math.max(d.free, 0), d.total) / d.total < LOW_FREE;

/** Internal drives first, then the removable ones, each by letter. */
export const orderDisks = (list: readonly DiskDrive[]): DiskDrive[] =>
  [...list].sort((a, b) => Number(a.removable) - Number(b.removable) || a.letter.localeCompare(b.letter));

/**
 * The drives the widget draws for version `v`: the system drive (the first internal one if Rust marked none), every drive in the
 * panel's order, or the fullest by share, the first in that order on a tie. None before the first read.
 */
export function barDisks(list: readonly DiskDrive[], v: WidgetVariants["disk"]): DiskDrive[] {
  const ordered = orderDisks(list);
  if (!ordered.length || v === "all") return ordered;
  if (v === "fullest") return [ordered.reduce((a, b) => (usedShare(b) > usedShare(a) ? b : a))];
  return [ordered.find((d) => d.system) ?? ordered[0]];
}

/** A folder a scan listed, by the id Rust keeps it under (taskbar/disks.rs `ScanFolder`): the page never holds its path. */
export interface ScanFolder {
  id: number;
  name: string;
  size: number;
}

/** One level of a scan (taskbar/disks.rs `DiskScan`): its ten largest folders, largest first, the bytes of the others, its own files, and whether the walk ended early. */
export interface DiskScan {
  folders: ScanFolder[];
  more: number;
  files: number;
  partial: boolean;
}

/** A row of a scan's page: a folder, the folders past the first ten, the files directly in it, or at a drive's root what no folder holds; `share` is of the whole. */
export interface ScanRow {
  kind: "folder" | "more" | "files" | "other";
  folder?: ScanFolder;
  size: number;
  share: number;
}

/**
 * A level's rows, largest first, for a folder of `used` bytes (the drive's used space at its `root`). What no folder holds only at a
 * drive's root and after a whole walk: the used space less all counted, which hard links (counted once per link) can push below zero,
 * and then it goes and the shares are of the sum. An empty row goes.
 */
export function scanRows(scan: DiskScan, used: number, root: boolean): ScanRow[] {
  const sum = scan.folders.reduce((a, f) => a + f.size, scan.more + scan.files);
  const of = Math.max(used, sum);
  const rows: Omit<ScanRow, "share">[] = [
    ...scan.folders.map((folder) => ({ kind: "folder" as const, folder, size: folder.size })),
    { kind: "other", size: root && !scan.partial ? used - sum : 0 },
    { kind: "files", size: scan.files },
    { kind: "more", size: scan.more },
  ];
  return rows.filter((r) => r.size > 0).sort((a, b) => b.size - a.size).map((r) => ({ ...r, share: of > 0 ? r.size / of : 0 }));
}

/**
 * A level of the scan page: a drive's root (`folder` null) or a folder a scan listed, under the token its scan is stopped by. `of` is
 * the size it was expected to have (the drive's used space, the folder's listed size), `counted` what the walk has read so far; no
 * answer and no error while it runs.
 */
export interface ScanLevel {
  token: number;
  folder: number | null;
  title: string;
  of: number;
  counted: number;
  scan: DiskScan | null;
  error: "busy" | "failed" | null;
}

/** The disk panel's scan page: the drive, its levels from the root down, and when one last changed. */
export interface ScanState {
  letter: string;
  at: number;
  levels: ScanLevel[];
}

/** How long the disk panel opens on a scan's answer, ms. */
export const SCAN_FRESH = 10 * 60_000;

/** Whether a level's scan is still running. */
export const scanning = (l: ScanLevel): boolean => l.scan === null && l.error === null;

/** The page the disk panel opens on: one whose scan still runs, however long it takes, or whose answer is under SCAN_FRESH old. */
export const freshScan = (s: ScanState | null, now: number): boolean => s !== null && (s.levels.some(scanning) || now - s.at < SCAN_FRESH);

/** How far a running scan got, 0 to 1: never past the end, which hard links can count beyond, and nothing without a size to measure against. */
export const scanProgress = (counted: number, of: number): number => (of > 0 ? Math.min(Math.max(counted, 0) / of, 1) : 0);

/** The rows a level's page shows: its answer's, or one for its progress or what went wrong. */
export const levelRows = (l: ScanLevel): number => (l.scan ? scanRows(l.scan, l.of, l.folder === null).length : 1);
