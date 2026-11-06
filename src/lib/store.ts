import { useSyncExternalStore } from "react";
// First of everything that reads localStorage: the demo swaps it for memory before any store loads.
import "../dev/demoStorage";

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
  use(): T;
}

/** Keeps a saved value that cannot be used under `<key>.bad`, so a reset does not erase the only copy. */
export function setAside(key: string, raw: string | null) {
  try {
    if (raw) localStorage.setItem(`${key}.bad`, raw);
  } catch {
    // Quota full or no storage: nothing more to do.
  }
}

/**
 * Minimal global store. With `persist` the state is mirrored to localStorage
 * (in Tauri the WebView profile persists).
 */
export function createStore<T>(initial: T, options: { persist?: string } = {}): Store<T> {
  const key = options.persist && `notch:${options.persist}`;
  let state = initial;
  if (key) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
      if (raw) state = JSON.parse(raw) as T;
    } catch {
      // Broken entry → continue with the default.
      setAside(key, raw);
    }
  }

  const listeners = new Set<() => void>();
  const store: Store<T> = {
    get: () => state,
    set(next) {
      state = typeof next === "function" ? (next as (prev: T) => T)(state) : next;
      if (key) {
        try {
          localStorage.setItem(key, JSON.stringify(state));
        } catch {
          // Quota full: the state lives on in memory, so typing and the app keep working; it is just not saved.
        }
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
