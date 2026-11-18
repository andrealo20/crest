import { test } from "node:test";
import assert from "node:assert/strict";
import { followStores, onActions, sendAction, shareStores, type Transport } from "./bridge.ts";
import { settingsClosedActions } from "./bridgeRules.ts";

/** Both windows on one bus: an emit reaches every handler of its event at once, whatever window it names, and stays in a log. */
function memoryBus() {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const log: { event: string; payload: unknown; to?: string }[] = [];
  const bus: Transport & { sent(event: string): { payload: unknown; to?: string }[] } = {
    emit(event, payload, to) {
      log.push({ event, payload, to });
      [...(handlers.get(event) ?? [])].forEach((h) => h(payload));
    },
    listen(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
      return () => void handlers.get(event)!.delete(handler);
    },
    sent: (event) => log.filter((e) => e.event === event).map(({ payload, to }) => ({ payload, to })),
  };
  return bus;
}

function memStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: unknown) {
      value = next as T;
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    watched: () => listeners.size > 0,
  };
}

test("the settings window gets every shared value after hello, then each change", () => {
  const bus = memoryBus();
  const notchSide = { a: memStore(1), b: memStore("x") }, settingsSide = { a: memStore(0), b: memStore("") };
  shareStores(bus, notchSide);
  followStores(bus, settingsSide);
  assert.equal(settingsSide.a.get(), 1);
  assert.equal(settingsSide.b.get(), "x");
  notchSide.a.set(2);
  assert.equal(settingsSide.a.get(), 2);
});

test("nothing is sent before a hello, and nothing after stop", () => {
  const bus = memoryBus();
  const notchSide = { a: memStore(1) };
  const stop = shareStores(bus, notchSide);
  notchSide.a.set(2);
  assert.deepEqual(bus.sent("bridge://state"), []);
  stop();
  bus.emit("bridge://hello", null);
  notchSide.a.set(3);
  assert.deepEqual(bus.sent("bridge://state"), []);
});

test("a share answers its own window's hello and sends there", () => {
  const bus = memoryBus();
  const a = memStore(1);
  shareStores(bus, { a }, { to: "taskbar", hello: "bar://hello" });
  bus.emit("bridge://hello", null);
  assert.deepEqual(bus.sent("bridge://state"), []);
  bus.emit("bar://hello", null);
  a.set(2);
  // A page that reloads says hello again and gets everything again.
  bus.emit("bar://hello", null);
  assert.deepEqual(bus.sent("bridge://state"), [
    { payload: { name: "a", value: 1 }, to: "taskbar" },
    { payload: { name: "a", value: 2 }, to: "taskbar" },
    { payload: { name: "a", value: 2 }, to: "taskbar" },
  ]);
});

test("a share with a condition sends only while it holds", () => {
  const bus = memoryBus();
  const a = memStore(1);
  const open = memStore(false);
  const stop = shareStores(bus, { a }, { when: open });
  const states = (...values: number[]) => values.map((value) => ({ payload: { name: "a", value }, to: "settings" }));
  bus.emit("bridge://hello", null);
  a.set(2);
  assert.deepEqual(bus.sent("bridge://state"), states());
  // A store tells its listeners of every set, so only a change to true sends everything again.
  open.set(true);
  open.set(true);
  assert.deepEqual(bus.sent("bridge://state"), states(2));
  a.set(3);
  assert.deepEqual(bus.sent("bridge://state"), states(2, 3));
  open.set(false);
  a.set(4);
  assert.deepEqual(bus.sent("bridge://state"), states(2, 3));
  stop();
  open.set(true);
  assert.deepEqual(bus.sent("bridge://state"), states(2, 3));
  assert.equal(open.watched(), false);
});

test("a condition waits for the hello and sends everything at each opening", () => {
  const bus = memoryBus();
  const a = memStore(1);
  const open = memStore(false);
  const stop = shareStores(bus, { a }, { when: open });
  const states = (...values: number[]) => values.map((value) => ({ payload: { name: "a", value }, to: "settings" }));
  open.set(true);
  assert.deepEqual(bus.sent("bridge://state"), states());
  bus.emit("bridge://hello", null);
  assert.deepEqual(bus.sent("bridge://state"), states(1));
  open.set(false);
  a.set(2);
  open.set(true);
  assert.deepEqual(bus.sent("bridge://state"), states(1, 2));
  open.set(false);
  open.set(1);
  a.set(3);
  assert.deepEqual(bus.sent("bridge://state"), states(1, 2));
  open.set(true);
  stop();
  a.set(4);
  assert.deepEqual(bus.sent("bridge://state"), states(1, 2, 3));
});

test("a follower can say hello its own way", () => {
  const bus = memoryBus();
  let hellos = 0;
  followStores(bus, { a: memStore(0) }, () => hellos++);
  assert.equal(hellos, 1);
  assert.deepEqual(bus.sent("bridge://hello"), []);
});

test("unknown store names are ignored", () => {
  const bus = memoryBus();
  const settingsSide = { a: memStore(0) };
  followStores(bus, settingsSide);
  bus.emit("bridge://state", { name: "secret", value: 9 });
  bus.emit("bridge://state", { name: "constructor", value: 9 });
  assert.equal(settingsSide.a.get(), 0);
});

test("only the known actions reach the notch", () => {
  const bus = memoryBus();
  const ran: unknown[] = [];
  onActions(bus, (a) => ran.push(a));
  sendAction(bus, { kind: "refresh", what: "github", force: true });
  bus.emit("bridge://action", { kind: "deleteEverything" });
  bus.emit("bridge://action", { kind: "refresh", what: "vault" });
  assert.deepEqual(ran, [{ kind: "refresh", what: "github", force: true }]);
});

test("a notices status check reaches the notch", () => {
  // The notch follows the sources and gives Windows' banners and sound back on what it reads; the settings page only asks.
  const bus = memoryBus();
  const ran: unknown[] = [];
  onActions(bus, (a) => ran.push(a));
  sendAction(bus, { kind: "refresh", what: "notices" });
  assert.deepEqual(ran, [{ kind: "refresh", what: "notices" }]);
});

test("a vault lock reaches the notch", () => {
  const bus = memoryBus();
  const ran: unknown[] = [];
  onActions(bus, (a) => ran.push(a));
  sendAction(bus, { kind: "lockVault" });
  assert.deepEqual(ran, [{ kind: "lockVault" }]);
});

test("the bar's requests reach the notch field for field, and nothing in a wrong shape does", () => {
  // Rust passes on only these from the bar (src-tauri/src/taskbar/panel.rs); the notch checks them again.
  const bus = memoryBus();
  const ran: unknown[] = [];
  onActions(bus, (a) => ran.push(a));
  const kept = [
    { kind: "refresh", what: "github" },
    { kind: "refresh", what: "github", force: true },
    ...[1, 30, 1440, null].map((minutes) => ({ kind: "awake", minutes })),
    { kind: "awakeOff" },
    { kind: "renewClaude" },
    { kind: "noticesClear" },
    { kind: "timerSilence" },
    { kind: "presentation" },
    { kind: "focusMute", on: true },
    { kind: "noticeDelete", id: "a1" },
    { kind: "noticeDelete", id: "a".repeat(128) },
  ];
  const refused = [
    { kind: "refresh", what: "evil" },
    ...[0, 1441, 2.5, "30", undefined].map((minutes) => ({ kind: "awake", minutes })),
    { kind: "focusMute", on: "yes" },
    { kind: "noticeDelete", id: "" },
    { kind: "noticeDelete", id: "a".repeat(129) },
    "timerSilence",
  ];
  [...kept, ...refused].forEach((a) => bus.emit("bridge://action", a));
  bus.emit("bridge://action", { kind: "timerSilence", x: 1 });
  assert.deepEqual(ran, [...kept, { kind: "timerSilence" }]);
});

test("closing_the_settings_window_resumes_hotkeys", () => {
  assert.ok(settingsClosedActions().some((a) => a.kind === "pauseHotkeys" && a.on === false));
});

test("closing the settings window locks the vault and reads again what the window may have changed", () => {
  // A closed window runs no React cleanup and no loop of its own: the vault it unlocked, a translation pair or a plugin it
  // was installing are settled here.
  assert.deepEqual(settingsClosedActions(), [
    { kind: "pauseHotkeys", on: false },
    { kind: "lockVault" },
    { kind: "refresh", what: "offline" },
    { kind: "refresh", what: "plugins" },
  ]);
});
