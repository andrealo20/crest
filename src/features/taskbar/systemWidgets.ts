// The rules of the bar's Top apps and Battery widgets and of the Hardware widget's network line, and what the system store reads for
// them. Pure, so they can be tested without the app around them.

import type { ClosedSettings } from "../../notch/row/parts.ts";
import type { ProcReading, SystemWant } from "../../platform/services.ts";
import { processMemory, processShare } from "../system/format.ts";

/** An app as the Top apps widget draws it: its share of the machine in percent, by CPU or by memory, and its memory in bytes. */
export interface TopApp {
  id: string;
  name: string;
  path: string | null;
  share: number;
  mem: number;
}

const MiB = 1_048_576;

/** One app of the Hardware tool's list as the widget reads it, by memory with `ram`; null while it has nothing to show. */
export function topApp(p: ProcReading, ram: boolean, memTotal: number, cores: number): TopApp | null {
  // sysinfo's first list after a start reads 0 for every process: no order to show yet.
  if (!ram && !(p.cpu > 0)) return null;
  const share = ram ? (memTotal > 0 ? (p.mem / memTotal) * 100 : 0) : p.cpu / Math.max(1, cores);
  // Whole MiB: the slice crosses to the bar only when a figure could change, not with every byte of the working set.
  return { id: p.id, name: p.name, path: p.path, share: Math.round(Math.min(100, share) * 10) / 10, mem: Math.round(p.mem / MiB) * MiB };
}

/** The app's figure on the face: its share with one decimal under 10, or its memory ("512M", "4.1G"). */
export const appFigure = (app: TopApp, ram: boolean) => (ram ? processMemory(app.mem) : `${processShare(app.share, 1)}%`);

/** A line's points in a `w` x `h` box, 0 at the bottom and `max` at the top, a pixel in from each edge; anything but a number is a gap and skipped (the dev sample may keep NaN). */
export function linePoints(values: readonly (number | null)[], max: number, w = 40, h = 16): [number, number][] {
  const step = w / Math.max(1, values.length - 1);
  return values.flatMap((v, i) =>
    typeof v !== "number" || Number.isNaN(v) ? [] : [[+(i * step).toFixed(1), +(h - 1 - (Math.min(max, Math.max(0, v)) / max) * (h - 2)).toFixed(1)] as [number, number]],
  );
}

/** The network's line never scales below 100 KB/s, so a link at rest stays a low line instead of filling the box. */
export const NET_FLOOR = 100_000;

/** The top of the network's line: the busier of download and upload over the window. */
export const netMax = (down: readonly (number | null)[], up: readonly (number | null)[]) =>
  [...down, ...up].reduce<number>((m, v) => (typeof v === "number" && v > m ? v : m), NET_FLOOR);

/** How many of a battery's `count` parts are lit: the first as soon as it holds any charge, none while the charge is unknown. */
export const batteryLit = (percent: number | null, count: number) => (percent === null ? 0 : Math.min(count, Math.max(0, Math.ceil((percent * count) / 100))));

/** The gauge's needle in degrees from straight up: -90 empty, 90 full. */
export const needleAngle = (percent: number | null) => -90 + Math.min(100, Math.max(0, percent ?? 0)) * 1.8;

/**
 * What the system store reads besides CPU, RAM and GPU outside the Hardware tool: the readings switched on for the notch while the
 * closed row shows them (`row`) or the bar's Hardware widget is on, the network for that widget's network line with NET off too,
 * the process list for Top apps, and the temperatures for Temperatures. `version`: the Hardware widget's version.
 */
export function systemWant(row: boolean, r: ClosedSettings["readings"], bar: readonly string[], version: string): SystemWant {
  const on = row || bar.includes("readings");
  const netLine = bar.includes("readings") && version === "net";
  return { net: (on && r.net) || netLine, temps: (on && r.temp) || bar.includes("temps"), power: on && r.power, battery: on && (r.battery || r.power), processes: bar.includes("processes") };
}
