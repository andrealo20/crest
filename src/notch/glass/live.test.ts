// The live glass's queue (live.ts) against a fake Rust whose commands answer only when a test says so; how the real one answers is in
// capture/glass_live.rs and sysevents.rs. Node cannot load what live.ts imports (Tauri, the settings, the store with React), so the
// hooks below hand it this file's fakes instead, give "./params" its ".ts" and turn import.meta.env.DEV off. Each test loads a new copy
// of live.ts, as a page just loaded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import type { GlassZone } from "../../platform/native";
import { LIVE_SETTLE_MS, type LiveMeta } from "./params.ts";

const LIVE = new URL("./live.ts", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!context.parentURL?.startsWith(LIVE)) return nextResolve(specifier, context);
    if (specifier === "./params") return nextResolve("./params.ts", context);
    return { url: import.meta.url, shortCircuit: true };
  },
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.startsWith(LIVE)) return loaded;
    return { ...loaded, source: Buffer.from(loaded.source as Uint8Array).toString().replaceAll("import.meta.env.DEV", "false") };
  },
});

// ---------- What live.ts imports ----------

export function createStore<T>(state: T) {
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: T) {
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
export const isMac = false, isNative = true;
export const viewZoom = () => 1;
export const settings = { get: () => page.settings.get(), subscribe: (l: () => void) => page.settings.subscribe(l) };
export const glassLive: typeof import("../../platform/native").glassLive = {
  supported: async () => ({ supported: true, reason: null }),
  exclude: (on) => command("exclude", on),
  start: (zone) => command("start", zone),
  stop: () => command("stop"),
};
export function onGlassLiveStop(handler: typeof page.stopped) {
  page.stopped = handler;
  return () => {};
}
export function onSessionState(handler: typeof page.session) {
  page.session = handler;
  return () => {};
}

// ---------- The fake Rust and the page ----------

interface Call { name: "exclude" | "start" | "stop"; arg?: unknown; resolve(value?: unknown): void; reject(code: string): void }
const page = {
  settings: createStore({ themes: { glass: true, glassLive: true } }),
  /** The commands not answered yet, and every command sent. */
  calls: [] as Call[],
  log: [] as string[],
  /** glass://live and status://session as live.ts listens to them. */
  stopped: (_: { gen: number; reason: string }) => {},
  session: (_: { locked: boolean; remote: boolean; asleep: boolean }) => {},
};
function command<T>(name: Call["name"], arg?: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    page.log.push(name === "exclude" ? `exclude ${arg}` : name);
    page.calls.push({ name, arg, resolve: resolve as Call["resolve"], reject });
  });
}

// A 760 x 532 window at 200 %, the closed notch's need in it and the zone that makes (params.test.ts).
Object.assign(globalThis, { window: globalThis, innerWidth: 760, innerHeight: 532, devicePixelRatio: 2 });
const NEED = { x: 510, y: 0, w: 500, h: 100 }, ZONE = { x: 462, y: 0, w: 596, h: 100 };
const UNLOCKED = { locked: false, remote: false, asleep: false };
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((done) => setImmediate(done));
};

let pages = 0;
/** A page just loaded with Glass and the switch as given: a new copy of live.ts, a glass layer that draws, Rust saying it can run. */
async function load(themes = { glass: true, glassLive: true }) {
  Object.assign(page, { settings: createStore({ themes }), calls: [], log: [] });
  const live = (await import(`./live.ts?page=${++pages}`)) as typeof import("./live");
  const drawn: LiveMeta[] = [];
  const layer = { uploadLive: (meta: LiveMeta) => (drawn.push(meta), true), freeLive() {} };
  live.setLiveRenderer(layer);
  live.startGlassLive();
  await flush();
  const take = (name: Call["name"]) => {
    const call = page.calls.shift();
    assert.equal(call?.name, name, `sent so far: ${page.log.join(", ")}`);
    return call!;
  };
  const answer = async (name: Call["name"], value?: unknown) => {
    take(name).resolve(value);
    await flush();
  };
  return {
    live, drawn, layer, answer,
    async refuse(name: Call["name"], code: string) {
      take(name).reject(code);
      await flush();
    },
    frame: (gen: number, seq: number, zone: GlassZone = ZONE) =>
      live.receiveLive({ kind: "glass-live", gen, seq, ...zone, ww: 1520, wh: 1064 }, new ArrayBuffer(zone.w * zone.h * 4)),
    /** Past the exclusion and the stop of the session a page before may have left. */
    async ready() {
      await answer("exclude");
      await answer("stop");
      assert.equal(page.calls.length, 0);
    },
    /** The closed notch's zone wanted and its session running as `gen`. */
    async run(gen: number) {
      live.wantLive(NEED);
      await answer("start", { gen, ...ZONE });
    },
  };
}
const last = () => page.calls.at(-1);

test("at load: the exclusion first, then a stop for the session a page before may have left", async () => {
  const t = await load();
  assert.deepEqual(page.log, ["exclude true"]);
  await t.answer("exclude");
  assert.deepEqual(page.log, ["exclude true", "stop"]);
  await t.answer("stop");
  assert.equal(page.calls.length, 0);
});

test("at load with the switch off: the exclusion is put back, which stops any session, and nothing more", async () => {
  const t = await load({ glass: true, glassLive: false });
  await t.answer("exclude");
  t.live.wantLive(NEED);
  assert.deepEqual(page.log, ["exclude false"]);
});

test("a zone wanted starts a session for it, with its slack; the first frame is drawn before the start answers", async () => {
  const t = await load();
  await t.ready();
  t.live.wantLive(NEED);
  assert.deepEqual(last()?.arg, ZONE);
  t.frame(3, 1);
  assert.equal(t.live.liveFrame.get(), true);
  await t.answer("start", { gen: 3, ...ZONE });
  t.frame(3, 2);
  assert.equal(t.drawn.length, 2);
  assert.equal(page.calls.length, 0);
  // The peek: a stop, and the last copy stays.
  t.live.wantLive(null);
  assert.equal(last()?.name, "stop");
  assert.equal(t.live.liveFrame.get(), true);
});

test("a restart asked for during a start, then a peek: the session just started is stopped", async () => {
  const t = await load();
  await t.ready();
  t.live.wantLive(NEED);
  t.live.restartLive();
  t.live.wantLive(null);
  await t.answer("start", { gen: 3, ...ZONE });
  assert.equal(last()?.name, "stop");
});

test("a restart asked for during a start: a new session once it has answered", async () => {
  const t = await load();
  await t.ready();
  t.live.wantLive(NEED);
  t.live.restartLive();
  await t.answer("start", { gen: 3, ...ZONE });
  assert.deepEqual(last(), { ...last(), name: "start", arg: ZONE });
});

test("Rust ends a session before its start has answered: the answer counts as a refusal, and nothing is asked until something changes", async () => {
  const t = await load();
  await t.ready();
  t.live.wantLive(NEED);
  t.frame(5, 1);
  page.stopped({ gen: 5, reason: "monitor" });
  assert.equal(t.live.liveFrame.get(), false);
  await t.answer("start", { gen: 5, ...ZONE });
  assert.equal(page.calls.length, 0);
  t.live.restartLive();
  assert.equal(last()?.name, "start");
});

test("a frame Rust posted before it ended the session, and that comes after, is not drawn", async () => {
  const t = await load();
  await t.ready();
  await t.run(3);
  t.frame(3, 1);
  page.stopped({ gen: 3, reason: "device" });
  assert.equal(t.live.liveFrame.get(), false);
  t.frame(3, 2);
  assert.equal(t.live.liveFrame.get(), false);
  assert.equal(t.drawn.length, 1);
  // The end of an older session, while a newer one runs, changes nothing.
  t.live.restartLive();
  await t.answer("start", { gen: 5, ...ZONE });
  t.frame(5, 1);
  page.stopped({ gen: 3, reason: "device" });
  assert.equal(t.live.liveFrame.get(), true);
});

test("the switch turned off during a start: the exclusion goes back after the answer, and that session's frames are not drawn", async () => {
  const t = await load();
  await t.ready();
  t.live.wantLive(NEED);
  page.settings.set({ themes: { glass: true, glassLive: false } });
  await t.answer("start", { gen: 3, ...ZONE });
  assert.equal(page.log.at(-1), "exclude false");
  t.frame(3, 1);
  assert.equal(t.live.liveFrame.get(), false);
  // On again: the exclusion, then the session.
  await t.answer("exclude");
  page.settings.set({ themes: { glass: true, glassLive: true } });
  assert.equal(page.log.at(-1), "exclude true");
  await t.answer("exclude");
  assert.equal(last()?.name, "start");
});

test("a start refused for the exclusion asks for the exclusion again, then starts", async () => {
  const t = await load();
  await t.ready();
  t.live.wantLive(NEED);
  await t.refuse("start", "not-excluded");
  assert.equal(page.log.at(-1), "exclude true");
  await t.answer("exclude");
  assert.equal(last()?.name, "start");
});

test("any other refusal waits for a change: the same zone asks for nothing, a moved window starts again", async () => {
  const t = await load();
  await t.ready();
  t.live.wantLive(NEED);
  await t.refuse("start", "transparency-off");
  t.live.wantLive(NEED);
  assert.equal(page.calls.length, 0);
  t.live.restartLive();
  assert.equal(last()?.name, "start");
});

test("after a new start the frames of the session before are not drawn", async () => {
  const t = await load();
  await t.ready();
  await t.run(3);
  t.frame(3, 1);
  t.live.restartLive();
  t.frame(3, 2);
  assert.equal(t.drawn.length, 1);
  await t.answer("start", { gen: 5, ...ZONE });
  t.frame(5, 1);
  // Nor an older frame of the same session.
  t.frame(5, 1);
  assert.equal(t.drawn.length, 2);
});

test("locked: Rust ends the session, and the unlock starts a new one", async () => {
  const t = await load();
  await t.ready();
  await t.run(3);
  page.stopped({ gen: 3, reason: "locked" });
  page.session({ ...UNLOCKED, locked: true });
  assert.equal(page.calls.length, 0);
  page.session(UNLOCKED);
  assert.equal(last()?.name, "start");
});

test("without a glass layer to draw it (unmounted, its WebGL context lost) the session stops, and a new one starts when the layer is back", async () => {
  const t = await load();
  await t.ready();
  await t.run(3);
  t.frame(3, 1);
  t.live.setLiveRenderer(null);
  assert.equal(t.live.liveFrame.get(), false);
  assert.equal(last()?.name, "stop");
  // The window moved meanwhile: nothing to start.
  t.live.restartLive();
  await t.answer("stop");
  assert.equal(page.calls.length, 0);
  t.live.setLiveRenderer(t.layer);
  assert.equal(last()?.name, "start");
});

test("the glass layer lost during a start that a restart follows: the session just started is stopped", async () => {
  const t = await load();
  await t.ready();
  t.live.wantLive(NEED);
  t.live.restartLive();
  t.live.setLiveRenderer(null);
  await t.answer("start", { gen: 3, ...ZONE });
  assert.equal(last()?.name, "stop");
});

test("the exclusion refused at load: the session a page before may have left is stopped all the same, and nothing more until the switch changes", async () => {
  const t = await load();
  await t.refuse("exclude", "exclude-failed");
  assert.equal(page.log.at(-1), "stop");
  await t.answer("stop");
  t.live.wantLive(NEED);
  assert.equal(page.calls.length, 0);
  page.settings.set({ themes: { glass: true, glassLive: false } });
  assert.equal(page.calls.length, 0);
  page.settings.set({ themes: { glass: true, glassLive: true } });
  assert.equal(page.log.at(-1), "exclude true");
});

test("a zone the shape has outgrown starts at once, one inside the running zone once it has settled", async () => {
  const t = await load();
  await t.ready();
  await t.run(3);
  // A notice card: wider and taller than the zone.
  t.live.wantLive({ x: 410, y: 0, w: 700, h: 132 });
  assert.deepEqual(last()?.arg, { x: 362, y: 0, w: 796, h: 132 });
  await t.answer("start", { gen: 5, x: 362, y: 0, w: 796, h: 132 });
  // Back to the row: much smaller, inside the zone that runs.
  t.live.wantLive(NEED);
  assert.equal(page.calls.length, 0);
  await new Promise((done) => setTimeout(done, LIVE_SETTLE_MS + 30));
  assert.deepEqual(last()?.arg, ZONE);
});

test("the window moved while a zone change waited: a new session even when the change comes to nothing", async () => {
  const t = await load();
  await t.ready();
  await t.run(3);
  t.live.wantLive({ x: 560, y: 0, w: 400, h: 100 });
  t.live.restartLive();
  assert.equal(page.calls.length, 0);
  t.live.wantLive(NEED);
  assert.deepEqual(last()?.arg, ZONE);
});
