// Translated from BrimDeck (Apache-2.0, github.com/MoFeng2223/BrimDeck), src/BrimDeck.Core/Storage.cs.
// The drives the Hardware tool shows: lettered volumes grouped by physical drive, internal drives first, then the ones
// that plug in (USB, SD and MMC media, removable media). Virtual disks are left out, and so are volumes too small to
// matter (a recovery partition with a letter).

import { diskLevel, plausible } from "./temps.ts";
import type { Level } from "./levels.ts";

export interface VolumeRaw { letter: string; total: number; free: number; disk: number | null }
export interface DiskRaw { number: number; model: string; bus: number; removable: boolean; ssd: boolean; temp: [number, number, number] | null }
export interface DrivesRaw { volumes: VolumeRaw[]; disks: DiskRaw[] }

export interface Drive { key: string; model: string; letters: string; total: number; used: number; temp: number | null; tempLevel: Level }

/** STORAGE_BUS_TYPE values of drives that plug in: USB, SD, MMC. */
const PLUG_BUS = new Set([7, 12, 13]);
/** STORAGE_BUS_TYPE of a virtual disk, left out. A file-backed virtual disk (a Dev Drive) stays. */
const VIRTUAL_BUS = 14;
export const SMALLEST_VOLUME = 1024 ** 3;

/** Internal drives, then the ones that plug in, each in the order of their first letter; a volume without a known
 * drive is an internal drive of its own. */
export function groupDrives(raw: DrivesRaw | null): Drive[] {
  if (!raw) return [];
  const disks = new Map(raw.disks.map((d) => [d.number, d]));
  const kept = raw.volumes.filter((v) => v.total >= SMALLEST_VOLUME && (v.disk === null || (disks.has(v.disk) && disks.get(v.disk)!.bus !== VIRTUAL_BUS)));
  const groups = new Map<string, VolumeRaw[]>();
  for (const v of kept) {
    const key = v.disk === null ? `vol ${v.letter}` : `disk ${v.disk}`;
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }
  const plugged = new Set<string>();
  const drives = [...groups].map(([key, vols]): Drive => {
    vols.sort((a, b) => a.letter.localeCompare(b.letter));
    const disk = vols[0].disk === null ? undefined : disks.get(vols[0].disk);
    if (disk && (disk.removable || PLUG_BUS.has(disk.bus))) plugged.add(key);
    const t = disk?.temp ? plausible(disk.temp[0]) : null;
    const total = vols.reduce((s, v) => s + v.total, 0);
    const used = vols.reduce((s, v) => s + Math.max(0, v.total - Math.min(v.free, v.total)), 0);
    return {
      key,
      model: disk?.model ?? "",
      letters: vols.map((v) => v.letter).join(" "),
      total,
      used,
      temp: t,
      tempLevel: t === null ? 0 : diskLevel(t, disk!.temp![1], disk!.temp![2]),
    };
  });
  return drives.sort((a, b) => Number(plugged.has(a.key)) - Number(plugged.has(b.key)) || a.letters.localeCompare(b.letters));
}
