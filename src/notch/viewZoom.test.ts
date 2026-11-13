// viewMetrics (viewZoom.ts) in a fake page: a browser at one scale cannot show that the scale is watched again after each change.
// Node cannot load what viewZoom.ts imports, so the hook hands it this file's fakes instead, as in glass/live.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const VIEW = new URL("./viewZoom.ts", import.meta.url).href;
registerHooks({
  resolve: (specifier, context, nextResolve) => (context.parentURL === VIEW ? { url: import.meta.url, shortCircuit: true } : nextResolve(specifier, context)),
});

// ---------- What viewZoom.ts imports ----------

export function createStore<T>(state: T) {
  return { get: () => state, set: (next: T) => void (state = next) };
}
export const isNative = true;
export const settings = { get: () => ({ behavior: { scale: 100 } }) };

test("the page's scale and size follow a move to another scale and a resize, and the scale is watched again after each change", async () => {
  const queries: { query: string; change: () => void; once?: boolean }[] = [];
  let resized = () => {};
  Object.assign(globalThis, {
    devicePixelRatio: 1, innerWidth: 760, innerHeight: 532,
    matchMedia: (query: string) => ({
      addEventListener: (_: string, change: () => void, options?: { once?: boolean }) => queries.push({ query, change, once: options?.once }),
    }),
    addEventListener: (_: string, listener: () => void) => (resized = listener),
  });
  const { viewMetrics } = (await import("./viewZoom.ts")) as typeof import("./viewZoom");
  assert.deepEqual(viewMetrics.get(), { dpr: 1, width: 760, height: 532 });
  assert.deepEqual(queries.map((q) => q.query), ["(resolution: 1dppx)"]);
  // On a monitor at 150 %: the query for 100 % changes, once, and the one for 150 % takes its place.
  Object.assign(globalThis, { devicePixelRatio: 1.5 });
  queries[0].change();
  assert.deepEqual(viewMetrics.get(), { dpr: 1.5, width: 760, height: 532 });
  assert.deepEqual(queries.map((q) => q.query), ["(resolution: 1dppx)", "(resolution: 1.5dppx)"]);
  Object.assign(globalThis, { devicePixelRatio: 1 });
  queries[1].change();
  assert.equal(viewMetrics.get().dpr, 1);
  assert.equal(queries.length, 3);
  // Each listens once: back at a scale seen before, its query would otherwise have two listeners.
  assert.ok(queries.every((q) => q.once === true));
  // A resize alone; one that changes nothing leaves the store as it is, so nothing renders for it.
  Object.assign(globalThis, { innerWidth: 900 });
  resized();
  assert.deepEqual(viewMetrics.get(), { dpr: 1, width: 900, height: 532 });
  const before = viewMetrics.get();
  resized();
  assert.equal(viewMetrics.get(), before);
});
