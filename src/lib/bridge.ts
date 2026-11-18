/*
 * The bridge between the notch and the settings window. The saved stores already reach every window through localStorage
 * (storeCore.ts); this carries what lives only in the notch's memory (update state, shortcut results, readings) to the settings
 * window, and the settings window's requests to the notch, which alone acts on them. No app imports, so the tests can load it;
 * the transport over Tauri events is in tauriTransport.ts.
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
 * Notch side: once the settings window says hello (it has loaded and listens), sends it every store's value, then each change.
 * Nothing goes out before the hello. Returns the function that stops it.
 */
export function shareStores(t: Transport, stores: Record<string, Shared>): () => void {
  let live = false;
  const send = (name: string) => t.emit(STATE, { name, value: stores[name].get() }, "settings");
  const offs = Object.keys(stores).map((name) =>
    stores[name].subscribe(() => {
      if (live) send(name);
    }),
  );
  const offHello = t.listen(HELLO, () => {
    live = true;
    Object.keys(stores).forEach(send);
  });
  return () => {
    live = false;
    offHello();
    offs.forEach((off) => off());
  };
}

/** Settings side: takes the notch's values into the stores of the same name, then says hello. Other names are ignored. */
export function followStores(t: Transport, stores: Record<string, Shared>): () => void {
  const off = t.listen(STATE, (payload) => {
    if (typeof payload !== "object" || payload === null) return;
    const { name, value } = payload as { name?: unknown; value?: unknown };
    if (typeof name === "string" && Object.hasOwn(stores, name)) stores[name].set(value);
  });
  t.emit(HELLO, null, "notch");
  return off;
}

const REFRESH = ["usage", "github", "leetcode", "calendar", "discord", "plugins", "offline", "notices"] as const;
type Refresh = (typeof REFRESH)[number];

/**
 * What the other windows may ask the notch to do. The bar asks through Rust (`taskbar_ask`), which passes on only the refreshes,
 * the presentation and the kinds from `awake` on.
 */
export type BridgeAction =
  | { kind: "pauseHotkeys"; on: boolean }
  | { kind: "closedEdit" }
  | { kind: "presentation" }
  | { kind: "checkUpdate" }
  | { kind: "installUpdate" }
  | { kind: "restart" }
  | { kind: "lockVault" }
  | { kind: "refresh"; what: Refresh; force?: boolean }
  /** Keep awake for 1 to 1440 minutes, or null for until it is turned off. */
  | { kind: "awake"; minutes: number | null }
  | { kind: "awakeOff" }
  /** Usage's "Im Terminal erneuern": claude in the notch's terminal, with the notch open on it. */
  | { kind: "renewClaude" }
  | { kind: "noticeDelete"; id: string }
  | { kind: "noticesClear" }
  | { kind: "timerSilence" }
  | { kind: "focusMute"; on: boolean };

export function sendAction(t: Transport, action: BridgeAction) {
  t.emit(ACTION, action, "notch");
}

/** Notch side: runs the other windows' requests. Anything that is not one of the actions above, field for field, is dropped. */
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
    case "focusMute":
      return typeof a.on === "boolean" ? { kind: "focusMute", on: a.on } : null;
    case "closedEdit":
    case "presentation":
    case "checkUpdate":
    case "installUpdate":
    case "restart":
    case "lockVault":
    case "awakeOff":
    case "renewClaude":
    case "noticesClear":
    case "timerSilence":
      return { kind: a.kind };
    case "awake":
      return a.minutes === null || (typeof a.minutes === "number" && Number.isInteger(a.minutes) && a.minutes >= 1 && a.minutes <= 1440)
        ? { kind: "awake", minutes: a.minutes }
        : null;
    case "noticeDelete":
      return typeof a.id === "string" && a.id.length >= 1 && a.id.length <= 128 ? { kind: "noticeDelete", id: a.id } : null;
    case "refresh": {
      const what = REFRESH.find((w) => w === a.what);
      if (!what || (a.force !== undefined && typeof a.force !== "boolean")) return null;
      return a.force === undefined ? { kind: "refresh", what } : { kind: "refresh", what, force: a.force };
    }
    default:
      return null;
  }
}
