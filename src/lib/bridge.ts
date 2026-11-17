/*
 * The bridge between the notch and its other windows. The saved stores already reach every window through localStorage
 * (storeCore.ts); this carries what lives only in the notch's memory (update state, shortcut results, readings) to the settings
 * window or another one (ShareOptions), and the settings window's requests to the notch, which alone acts on them. No app
 * imports, so the tests can load it; the transport over Tauri events is in tauriTransport.ts.
 */

/** Sends an event to a window by label, and listens to events sent to this one. */
export interface Transport {
  emit(event: string, payload: unknown, to?: string): void;
  listen(event: string, handler: (payload: unknown) => void): () => void;
}

/** A store as the bridge sees it; every Store fits. */
export interface Shared {
  get(): unknown;
  set(value: unknown): void;
  subscribe(listener: () => void): () => void;
}

const STATE = "bridge://state";
const HELLO = "bridge://hello";
const ACTION = "bridge://action";

/**
 * `to` is the window a share serves (the settings window by default), and `hello` the event its hello arrives as (Rust sends it
 * for a window that may not emit).
 */
export interface ShareOptions {
  to?: string;
  hello?: string;
  when?: Shared;
}

/**
 * Notch side: once the window says hello (it has loaded and listens), sends it every store's value, then each change. Nothing
 * goes out before the hello, nor while `when` is not true; each time `when` turns true, every value goes out again. Returns the
 * function that stops it.
 */
export function shareStores(t: Transport, stores: Record<string, Shared>, options: ShareOptions = {}): () => void {
  const { to = "settings", hello = HELLO, when } = options;
  let live = false;
  const holds = () => !when || when.get() === true;
  let held = holds();
  const send = (name: string) => t.emit(STATE, { name, value: stores[name].get() }, to);
  const sendAll = () => Object.keys(stores).forEach(send);
  const offs = Object.keys(stores).map((name) =>
    stores[name].subscribe(() => {
      if (live && holds()) send(name);
    }),
  );
  const offHello = t.listen(hello, () => {
    live = true;
    if (holds()) sendAll();
  });
  // A store tells its listeners of every set, so only a change to true sends everything again.
  const offWhen = when?.subscribe(() => {
    const was = held;
    held = holds();
    if (live && held && !was) sendAll();
  });
  return () => {
    live = false;
    offHello();
    offWhen?.();
    offs.forEach((off) => off());
  };
}

/**
 * Follower side: takes the notch's values into the stores of the same name, then says hello: by default an event to the notch,
 * or `hello` for a window that may not emit. Other names are ignored.
 */
export function followStores(
  t: Transport,
  stores: Record<string, Shared>,
  hello: () => void = () => t.emit(HELLO, null, "notch"),
): () => void {
  const off = t.listen(STATE, (payload) => {
    if (typeof payload !== "object" || payload === null) return;
    const { name, value } = payload as { name?: unknown; value?: unknown };
    if (typeof name === "string" && Object.hasOwn(stores, name)) stores[name].set(value);
  });
  hello();
  return off;
}

const REFRESH = ["usage", "github", "leetcode", "calendar", "discord", "plugins", "offline", "notices"] as const;
type Refresh = (typeof REFRESH)[number];

/** What the settings window may ask the notch to do. */
export type BridgeAction =
  | { kind: "pauseHotkeys"; on: boolean }
  | { kind: "closedEdit" }
  | { kind: "presentation" }
  | { kind: "checkUpdate" }
  | { kind: "installUpdate" }
  | { kind: "restart" }
  | { kind: "lockVault" }
  | { kind: "refresh"; what: Refresh; force?: boolean };

export function sendAction(t: Transport, action: BridgeAction) {
  t.emit(ACTION, action, "notch");
}

/** Notch side: runs the settings window's requests. Anything that is not one of the actions above, field for field, is dropped. */
export function onActions(t: Transport, run: (action: BridgeAction) => void): () => void {
  return t.listen(ACTION, (payload) => {
    const action = asAction(payload);
    if (action) run(action);
  });
}

/** A copy with only the known fields, or null. */
function asAction(payload: unknown): BridgeAction | null {
  if (typeof payload !== "object" || payload === null) return null;
  const a = payload as Record<string, unknown>;
  switch (a.kind) {
    case "pauseHotkeys":
      return typeof a.on === "boolean" ? { kind: "pauseHotkeys", on: a.on } : null;
    case "closedEdit":
    case "presentation":
    case "checkUpdate":
    case "installUpdate":
    case "restart":
    case "lockVault":
      return { kind: a.kind };
    case "refresh": {
      const what = REFRESH.find((w) => w === a.what);
      if (!what || (a.force !== undefined && typeof a.force !== "boolean")) return null;
      return a.force === undefined ? { kind: "refresh", what } : { kind: "refresh", what, force: a.force };
    }
    default:
      return null;
  }
}
