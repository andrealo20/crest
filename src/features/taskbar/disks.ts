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
