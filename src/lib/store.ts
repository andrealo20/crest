import { useSyncExternalStore } from "react";
// First of everything that reads localStorage: the demo swaps it for memory before any store loads.
import "../dev/demoStorage";

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
  use(): T;
}

/**
 * Minimal global store. With `persist` the state is mirrored to localStorage
 * (in Tauri the WebView profile persists).
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
      if (key) localStorage.setItem(key, JSON.stringify(state));
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
