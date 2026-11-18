import { createStore } from "../../lib/store";

// Apart from snapshot.ts, so the bar's window takes them without loading the open panel's copy and its listener for Rust's buffers.

function mediaStore(query: string) {
  const q = typeof matchMedia === "function" ? matchMedia(query) : null;
  const store = createStore(q?.matches ?? false);
  q?.addEventListener("change", (e) => store.set(e.matches));
  return store;
}
/** Media the glass turns off with; WebView2 and the browser follow the system's setting. */
export const contrastMore = mediaStore("(prefers-contrast: more)");
export const reducedTransparency = mediaStore("(prefers-reduced-transparency: reduce)");
