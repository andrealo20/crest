import { measureTabular, measureText } from "../../../notch/row/measure";
import { diskSize } from "../../system/format";
import { lowSpace, usedShare, type DiskDrive } from "../disks";

/*
 * The disk space widget on Crest's bar: each drive it draws (barDisks) as its letter and free space over a bar filled to its use,
 * red under 10 % free. Fixed widths for the widest figure, so a drive filling up moves no neighbour.
 */

const GAP = 8;
/** A drive's width: its letter and the widest free space, "888 MB". */
const driveWidth = (d: DiskDrive) => measureText(`${d.letter} `) + measureTabular("888 MB");
export const disksWidth = (list: readonly DiskDrive[]) => list.reduce((s, d, i) => s + (i ? GAP : 0) + driveWidth(d), 0);

/** One drive: the letter and its free space over its use. */
function Drive({ d }: { d: DiskDrive }) {
  const low = lowSpace(d);
  return (
    <span className={`flex flex-col gap-0.5 ${low ? "text-red" : "text-label"}`} style={{ width: driveWidth(d) }}>
      <span className="whitespace-nowrap text-footnote leading-none font-medium">
        {d.letter} <span className="tabular">{diskSize(d.free)}</span>
      </span>
      <span className="relative block h-[3px] overflow-hidden rounded-full material:bg-fill-3!" style={{ background: "color-mix(in srgb, currentColor 25%, transparent)" }}>
        <span className="absolute inset-y-0 left-0 block rounded-full bg-current" style={{ width: `${usedShare(d) * 100}%` }} />
      </span>
    </span>
  );
}

/** The drives side by side. */
export function DiskFace({ list }: { list: readonly DiskDrive[] }) {
  return (
    <span className="flex items-center" style={{ gap: GAP }}>
      {list.map((d) => <Drive key={d.letter} d={d} />)}
    </span>
  );
}
