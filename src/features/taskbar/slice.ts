import { useEffect } from "react";
import { barFeed, type BarFeed } from "./barStores";

/** Writes a widget's slice only when it changed: each write goes to the bar. */
export function useSlice<K extends keyof BarFeed>(key: K, value: BarFeed[K]) {
  const json = JSON.stringify(value);
  useEffect(() => {
    if (JSON.stringify(barFeed.get()[key]) !== json) barFeed.set((f) => ({ ...f, [key]: value }));
  }, [key, json]);
}
