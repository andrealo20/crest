import { createStore } from "../../lib/store";
import { MAX_ZONES, isZone, moveZone, normalizeZones } from "./zones";

/** The time zones shown below your own, in the order chosen (IANA names). */
export const clocks = createStore<string[]>([], { persist: "clocks" });
// A broken or foreign entry becomes a clean list rather than a row that throws.
clocks.set(normalizeZones);

export const clockActions = {
  add: (zone: string) => clocks.set((list) => (isZone(zone) && !list.includes(zone) && list.length < MAX_ZONES ? [...list, zone] : list)),
  remove: (zone: string) => clocks.set((list) => list.filter((z) => z !== zone)),
  move: (zone: string, by: -1 | 1) => clocks.set((list) => moveZone(list, zone, by)),
};
