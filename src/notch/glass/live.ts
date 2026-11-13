// The live glass on the closed notch and the capsule (docs/themes.md, Glass; capture/glass_live.rs, Windows 11 24H2): a capture session
// around the closed shape, asked for from here one command at a time, its frames uploaded into the glass's second texture (GlassLayer.tsx).
// While Glass and "Also the closed notch and capsule" are on, the notch window stays out of every capture, running or not.

import { createStore } from "../../lib/store";
import { glassLive, isMac, isNative, onGlassLiveStop, onSessionState, type GlassLiveSupport, type GlassZone } from "../../platform/native";
import { settings } from "../../settings/store";
import { viewZoom } from "../viewZoom";
import { GLASS, LIVE_SETTLE_MS, liveAccepts, liveMetaOk, liveStep, liveZone, sameZone, zoneHolds, type LiveMeta, type LiveStep } from "./params";

/** Whether the live glass can run here; null until Rust answers (always on a Mac, and in the browser without ?glassLive). */
export const liveSupport = createStore<GlassLiveSupport | null>(null);
/** A live copy is in the glass's texture. */
export const liveFrame = createStore(false);
/** What stops the copy for the whole session (status://session): the lock, a remote client, the screen asleep or just back. */
export const liveSession = createStore({ locked: false, remote: false, asleep: false });

/** The glass layer's side (GlassLayer.tsx): `uploadLive` puts a frame in the second texture and says whether it can be drawn. */
export interface LiveRenderer { uploadLive(meta: LiveMeta, bytes: Uint8Array): boolean; freeLive(): void }
let renderer: LiveRenderer | null = null;

type Api = typeof glassLive;
let api: Api | null = isNative ? glassLive : null;

// The exclusion wanted, the one Rust has (null: not known yet, as at load) and a refusal of it.
let exclude = false, excluded: boolean | null = null, refused = false;
// The zone wanted, the one running and a refusal that waits for something to change. A session started by the page before a reload may
// still run, so `have` starts as one: the first step after the exclusion stops or replaces it.
let want: GlassZone | null = null, have: GlassZone | null = { x: 0, y: 0, w: 0, h: 0 }, blocked = false;
// The newest gen seen, the oldest whose frames count, the newest Rust stopped on its own, the last frame drawn.
let maxGen = 0, floor = 1, ended = 0, last = { gen: 0, seq: 0 };
// A command in flight, a restart asked for meanwhile, a zone change waiting, a restart that waits for that change.
let busy = false, again = false, settle = 0, moved = false;

/** The zone to run a session for: none while nothing can draw its frames (the canvas gone, its WebGL context lost). */
const zone = () => (renderer ? want : null);

/** One command at a time: a start in flight never crosses a stop or the exclusion. */
function pump() {
  if (busy || !api || !liveSupport.get()) return;
  const step = liveStep({ exclude: exclude && !refused, excluded, want: zone(), have, blocked });
  if (!step) return;
  busy = true;
  void run(api, step).finally(() => {
    busy = false;
    // A new session only for a zone still wanted; with none, the session just started must still be stopped.
    if (again && zone()) {
      have = null;
      blocked = false;
    }
    again = false;
    pump();
  });
}

/** No session runs and none starts until something changes; the closed shapes take their colour. */
function gone() {
  have = null;
  blocked = true;
  dropLive();
}

async function run(call: Api, step: NonNullable<LiveStep>) {
  if (step.do === "exclude") {
    // Off stops the session in Rust too: a frame it posted before that is not drawn.
    if (!step.on) floor = maxGen + 1;
    const ok = await call.exclude(step.on).then(() => true, () => false);
    excluded = step.on && ok;
    // Refused (exclude-failed): the flag stays as it was, and nothing more is asked until the switches change.
    refused = step.on && !ok;
    if (!step.on) {
      have = null;
      dropLive();
    }
  } else if (step.do === "start") {
    floor = maxGen + 1;
    await call.start(step.zone).then(
      (r) => {
        maxGen = Math.max(maxGen, r.gen);
        floor = Math.max(floor, r.gen);
        // Stopped by Rust already (glass://live can come before this answer).
        if (r.gen <= ended) return gone();
        // The zone asked for, not the one cut to the monitor: compared with the next one wanted.
        have = step.zone;
        if (import.meta.env.DEV) console.debug("glass live", r.gen, step.zone);
      },
      (code: unknown) => {
        // The session before is gone too.
        gone();
        // The flag was put back meanwhile: the exclusion first, then a start again.
        if (code === "not-excluded") {
          excluded = null;
          blocked = false;
        }
        if (import.meta.env.DEV) console.debug("glass live", code);
      },
    );
  } else {
    floor = maxGen + 1;
    have = null;
    await call.stop().catch(() => {});
  }
}

/** The zone the closed shape needs (params.ts liveNeed), or null: a session for it, moved once the shape has settled, or none. */
export function wantLive(need: GlassZone | null) {
  window.clearTimeout(settle);
  settle = 0;
  const win = { w: Math.round(innerWidth * devicePixelRatio), h: Math.round(innerHeight * devicePixelRatio) };
  const next = need && liveZone(need, want, Math.round(GLASS.zoneSlack * viewZoom() * devicePixelRatio), win);
  if (sameZone(next, want)) {
    // The window moved while a zone change waited, and the change came to nothing.
    if (moved) restartLive();
    return;
  }
  const apply = () => {
    settle = 0;
    moved = false;
    want = next;
    blocked = false;
    pump();
  };
  // A first session, a stop and a zone the shape has outgrown, at once: past the running zone the glass shows its veil alone. A
  // running one moves to a zone inside its own once nothing changed for LIVE_SETTLE_MS.
  if (next && want && zoneHolds(want, next)) settle = window.setTimeout(apply, LIVE_SETTLE_MS);
  else apply();
}

/** A new session for the zone wanted, whose first frame comes even on a still screen: the window moved, the texture was lost. */
export function restartLive() {
  if (!zone()) return;
  // A zone change on its way opens a new session anyway.
  if (settle) return void (moved = true);
  moved = false;
  if (busy) again = true;
  else {
    have = null;
    blocked = false;
    pump();
  }
}

/** The live copy goes from the texture; the closed shapes take their colour again. */
export function dropLive() {
  renderer?.freeLive();
  if (liveFrame.get()) liveFrame.set(false);
}

/** The glass layer comes and goes, also with its WebGL context: without one the session stops, with one a new session starts. */
export function setLiveRenderer(r: LiveRenderer | null) {
  renderer = r;
  if (!r) {
    if (liveFrame.get()) liveFrame.set(false);
    pump();
  } else restartLive();
}

/** A frame from Rust; snapshot.ts hands over the `glass-live` ones. Never write into it (snapshot.ts receive says why). */
export function receiveLive(meta: unknown, data: ArrayBuffer) {
  if (!liveMetaOk(meta, data.byteLength)) return;
  maxGen = Math.max(maxGen, meta.gen);
  const win = [Math.round(innerWidth * devicePixelRatio), Math.round(innerHeight * devicePixelRatio)] as const;
  if (!renderer || !liveAccepts({ want: want !== null, floor, last }, meta, win, data.byteLength)) return;
  if (!renderer.uploadLive(meta, new Uint8Array(data, 0, meta.w * meta.h * 4))) return;
  last = { gen: meta.gen, seq: meta.seq };
  if (!liveFrame.get()) liveFrame.set(true);
}

/** At start (main.tsx): asks whether the live glass can run, keeps the exclusion with Glass and the switch, listens to Rust. */
export function startGlassLive() {
  if (isMac) return;
  if (!isNative) {
    if (!new URLSearchParams(location.search).has("glassLive")) return;
    void import("../../dev/glassBackdrop").then(({ fakeLive }) => {
      api = fakeLive(receiveLive);
      liveSupport.set({ supported: true, reason: null });
    });
  } else {
    void glassLive.supported().then(
      (s) => liveSupport.set(s),
      () => liveSupport.set({ supported: false, reason: "failed" }),
    );
    onGlassLiveStop(({ gen, reason }) => {
      maxGen = Math.max(maxGen, gen);
      // An older session's end, while a newer one starts, changes nothing; the end of one whose start has not answered yet does.
      if (gen < floor) return;
      ended = Math.max(ended, gen);
      // A frame Rust posted before it stopped may come after this.
      floor = Math.max(floor, gen + 1);
      gone();
      if (import.meta.env.DEV) console.debug("glass live stopped", reason);
    });
    onSessionState((s) => {
      liveSession.set(s);
      if (!s.locked && !s.remote && !s.asleep) {
        blocked = false;
        pump();
      }
    });
  }
  // Asked at load with the state as it is, once Rust has said whether it can run, and again on every change.
  const sync = () => {
    const t = settings.get().themes, on = t.glass && t.glassLive && liveSupport.get()?.supported === true;
    if (on === exclude && excluded !== null) return;
    exclude = on;
    if (!on) refused = false;
    pump();
  };
  settings.subscribe(sync);
  liveSupport.subscribe(sync);
  sync();
}
