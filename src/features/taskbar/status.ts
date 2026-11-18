import { createStore } from "../../lib/store";
import { status } from "../../platform/services";
import type { BarStatus } from "./statusModel";

/** In the bar's window: the power, the network and the volume Stato draws, as Rust last sent them; null where it has said nothing. */
export const barStatus = createStore<BarStatus>({ power: null, network: null, sound: null });

/**
 * Follows Rust's power, network and volume for Stato; returns the stop. The bar runs it only while it draws Stato, and nothing on the
 * page reads at intervals. Not in the browser, where the dev sample stands in (dev/barSample.ts).
 */
export function startStatus(): () => void {
  return status.onBar((patch) => barStatus.set((s) => ({ ...s, ...patch })));
}
