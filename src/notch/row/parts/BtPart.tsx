// Device batteries as a part of the closed row and its column: the lowest battery of the connected Bluetooth devices. Also the notch's
// one reader of the paired devices for the bar's widget (deviceSources.tsx), and the face of its `lowest` version.

import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { fade } from "../../../design/motion";
import { btLow, btShown, type BtDevice } from "../../../features/taskbar/quickPages";
import { t } from "../../../i18n";
import { createStore } from "../../../lib/store";
import { taskbar } from "../../../platform/services";
import { measureTabular } from "../measure";
import { btIcon } from "../status";
import { STATUS_ICON } from "../statusIcons";

/** How often the devices are read besides each connection the Bluetooth alerts hear: the battery changes slowly. */
const BT_EVERY = 2 * 60_000;

/** The last list read while someone wants it; null before the first answer. */
const devices = createStore<BtDevice[] | null>(null);
let users = 0;
let stop: (() => void) | null = null;

/** Reads now, every BT_EVERY and on each device the Bluetooth alerts hear (only while they are on); a failed read keeps the last list. */
function start(): () => void {
  let on = true;
  const read = () => void taskbar.btDevices().then((d) => on && devices.set(d), () => {});
  read();
  const id = window.setInterval(read, BT_EVERY);
  const off = taskbar.onBluetooth(read);
  return () => {
    on = false;
    window.clearInterval(id);
    off();
    devices.set(null);
  };
}

/**
 * The paired devices while `on`, null before the first read. One reader for the bar's widget and the closed row: the first user starts
 * the reads, the last one stops them, so two never read in parallel. Windows' store of paired devices only, never a radio search.
 */
export function useBtBatteries(on: boolean): BtDevice[] | null {
  useEffect(() => {
    if (!on) return;
    if (users++ === 0) stop = start();
    return () => {
      if (--users === 0) {
        stop?.();
        stop = null;
      }
    };
  }, [on]);
  const list = devices.use();
  return on ? list : null;
}

/** What the label over the widget and a screen reader say: each device's name and battery. */
export const btSpoken = (list: BtDevice[]) => list.map((d) => t("{n} · {p} %", { n: d.name, p: d.battery ?? 0 })).join(", ");

const ICON = 16, GAP = 4;
/** Fixed: a battery going from 9 to 10 % moves nothing. */
export const btLowestWidth = () => ICON + GAP + measureTabular("100%");

/** The lowest device's icon and battery, red at 20 % or less; another device becoming the lowest fades over it in the same cell. */
export function BtLowest({ device: d }: { device: BtDevice }) {
  const Icon = STATUS_ICON[btIcon(d.categories)];
  const p = d.battery ?? 0;
  return (
    <span className="grid shrink-0" style={{ width: btLowestWidth() }} role="img" aria-label={btSpoken([d])}>
      <AnimatePresence initial={false}>
        <motion.span
          key={d.id}
          className={`col-start-1 row-start-1 flex items-center ${btLow(p) ? "text-red" : "text-label"}`}
          style={{ gap: GAP }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: fade }}
          exit={{ opacity: 0, transition: fade }}
          aria-hidden
        >
          <Icon size={ICON} weight="regular" className="shrink-0" />
          <span className="tabular text-left text-footnote font-medium" style={{ width: measureTabular("100%") }}>
            {p}%
          </span>
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** The lowest battery in the row or the column, its width and how it draws, while `on` (Windows only); null without a device that reports one. */
export function useBtPart(on: boolean): { width: number; draw: () => ReactNode } | null {
  const lowest = btShown(useBtBatteries(on) ?? [], "lowest")[0];
  return lowest ? { width: btLowestWidth(), draw: () => <BtLowest device={lowest} /> } : null;
}
