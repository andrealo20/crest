import { useSyncExternalStore } from "react";
import { saveKey } from "../platform/kv";

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
  use(): T;
}

/**
 * Minimal global store. With `persist` the state is mirrored to localStorage
 * and, in the notch, to Crest's own file (platform/kv.ts).
 */
export function createStore<T>(initial: T, options: { persist?: string } = {}): Store<T> {
  const key = options.persist && `notch:${options.persist}`;
  let state = initial;
  if (key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) state = JSON.parse(raw) as T;
    } catch {
      // Broken entry → continue with the default.
    }
  }

  const listeners = new Set<() => void>();
  const store: Store<T> = {
    get: () => state,
    set(next) {
      state = typeof next === "function" ? (next as (prev: T) => T)(state) : next;
      if (key) {
        const raw = JSON.stringify(state);
        localStorage.setItem(key, raw);
        saveKey(key, raw);
      }
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    use: () => useSyncExternalStore(store.subscribe, store.get),
  };
  return store;
}
