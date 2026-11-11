import { createStore } from "../../lib/store";
import { glassBackdrop, isMac, isNative, onSharedBuffer } from "../../platform/native";
import { BUFFER_WAIT_MS, takes, type SnapshotMeta } from "./params";

/*
 * The glass's copy of the screen behind the window: asked for as the pointer rests on the notch (capture/backdrop.rs, in the browser
 * src/dev/glassBackdrop.ts), uploaded into the glass's texture when it comes, dropped once the panel has closed. Each request raises
 * `seq`, and only a copy with the latest `seq` is drawn; `takenAt` is when it came.
 */
export const snapshot = createStore({ seq: 0, ready: false, pending: false, takenAt: 0 });

/** WebGL refused or broken for this session (no context, failIfMajorPerformanceCaveat, programs that do not link). */
export const glassBroken = createStore(false);

function mediaStore(query: string) {
  const q = typeof matchMedia === "function" ? matchMedia(query) : null;
  const store = createStore(q?.matches ?? false);
  q?.addEventListener("change", (e) => store.set(e.matches));
  return store;
}
/** Media the glass turns off with; WebView2 and the browser follow the system's setting. */
export const contrastMore = mediaStore("(prefers-contrast: more)");
export const reducedTransparency = mediaStore("(prefers-reduced-transparency: reduce)");

/** The glass layer (GlassLayer.tsx): `upload` puts a copy in its texture and says whether it can be drawn, `free` drops the texture. */
export interface GlassRenderer { upload(meta: SnapshotMeta, bytes: Uint8Array): boolean; free(): void }
let renderer: GlassRenderer | null = null;
export function setGlassRenderer(r: GlassRenderer | null) {
  renderer = r;
}

let askedAt = 0;

/** Asks for a new copy; a copy asked for before no longer counts. `keep` leaves the one there is on screen until the new one comes. */
export function requestSnapshot(keep = false) {
  const seq = snapshot.get().seq + 1;
  snapshot.set((s) => ({ ...s, seq, ready: keep && s.ready, pending: true }));
  askedAt = performance.now();
  if (!isNative) return void fake(seq);
  glassBackdrop(seq).then(
    // The buffer may come before or after the answer; past this it is not waited for.
    () => window.setTimeout(() => giveUp(seq), BUFFER_WAIT_MS),
    (code: unknown) => {
      // A rejection of an older request ("stale" among them) leaves the newer one alone.
      if (snapshot.get().seq !== seq) return;
      giveUp(seq);
      if (import.meta.env.DEV) console.debug("glass", code);
    },
  );
}

function giveUp(seq: number) {
  const s = snapshot.get();
  if (s.seq === seq && s.pending) snapshot.set({ ...s, pending: false });
}

/** Drops the copy: one on its way is released unused, and the texture goes, so no pixels of other apps stay in memory. */
export function dropSnapshot() {
  snapshot.set((s) => ({ ...s, seq: s.seq + 1, ready: false, pending: false }));
  renderer?.free();
}

/**
 * A buffer that came in; the bridge releases it right after. Never write into it: a write into the read-only shared buffer crashes
 * WebView2's renderer, all of Crest's interface with it. The bytes are BGRA and the shader reads them so (.bgr).
 */
function receive(meta: unknown, data: ArrayBuffer) {
  const s = snapshot.get();
  const win = [Math.round(innerWidth * devicePixelRatio), Math.round(innerHeight * devicePixelRatio)] as const;
  if (!renderer || !takes(s, meta, win, data.byteLength)) return;
  const ready = renderer.upload(meta, new Uint8Array(data, 0, meta.w * meta.h * 4));
  snapshot.set({ ...s, ready, pending: false, takenAt: Date.now() });
  // From the request to the texture: the cold case the first measurements left open.
  if (import.meta.env.DEV) console.debug("glass", `${Math.round(performance.now() - askedAt)} ms`);
}

if (isNative && !isMac) onSharedBuffer(receive);

/** The browser's stand-in for Rust: the fake desktop as BGRA bytes after ?glassDelay ms (30 by default). */
async function fake(seq: number) {
  const { fakeBackdrop } = await import("../../dev/glassBackdrop");
  const q = new URLSearchParams(location.search);
  await new Promise((done) => setTimeout(done, Number(q.get("glassDelay") ?? 30)));
  const w = Math.round(innerWidth * devicePixelRatio), h = Math.round(innerHeight * devicePixelRatio);
  receive({ kind: "glass-backdrop", seq, x: 0, y: 0, w, h, ww: w, wh: h }, fakeBackdrop(w, h, q.get("glassBackdrop")).buffer);
}
