// The notch's sources of the bar's Device batteries and Temperatures widgets, which feed.tsx runs while the widget is on the bar.

import { useBtBatteries } from "../../notch/row/parts/BtPart";
import { settings } from "../../settings/store";
import { system } from "../system/store";
import { tempsFeed } from "../system/thermals";
import { EMPTY_FEED, barFeed } from "./barStores";
import { variantOf } from "./model";
import { btShown } from "./quickPages";
import { useSlice } from "./slice";

/** The connected devices that report a battery, at most four, in the feed's btDevices slice: never the other paired devices' names. */
export function BluetoothSource(): null {
  const list = useBtBatteries(true);
  // Before the first read (and after each rest) the bar keeps what it shows rather than its icon.
  useSlice("btDevices", list ? btShown(list, "devices") : barFeed.get().btDevices);
  return null;
}

/** The series the line has shown this session, kept while the widget comes and goes. */
const seen = new Set<"cpu" | "gpu">();

/** The temperatures now and over the last 10 minutes, or the fans, in the feed's temps slice: only what the widget's version draws. */
export function TempsSource(): null {
  const fans = variantOf(settings.use().taskbar.variants, "temps") === "fans";
  const st = system.use();
  useSlice("temps", fans ? { ...EMPTY_FEED.temps, fans: st.fans } : tempsFeed(st.tempLine, st.cpuTemp, st.gpuTemp, seen));
  return null;
}
