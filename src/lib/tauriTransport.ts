import { emit, emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isNative } from "../platform/native";
import { sendAction, type BridgeAction, type Transport } from "./bridge";

/*
 * The bridge's transport over Tauri events, between Crest's windows. A listen registers asynchronously: `ready` waits for
 * every one started so far and each emit waits for it, so a hello is never answered before this window listens for the answer.
 * In the browser there is no other window: it does nothing.
 */
let ready: Promise<unknown> = Promise.resolve();

export const tauriTransport: Transport = {
  emit(event, payload, to) {
    if (!isNative) return;
    void ready.then(() => (to ? emitTo(to, event, payload) : emit(event, payload))).catch(() => {});
  },
  listen(event, handler) {
    if (!isNative) return () => {};
    // On this window only, so another window's events do not reach it.
    const off = getCurrentWebviewWindow().listen(event, (e) => handler(e.payload));
    ready = Promise.all([ready, off.catch(() => {})]);
    return () => void off.then((f) => f());
  },
};

/** Settles once every `listen` started so far has registered, for a window whose hello does not go through `emit`. */
export const listening = (): Promise<unknown> => ready;

/** From a window other than the notch: asks the notch to do it (src/features/settings/window/shared.ts runs it). */
export function askNotch(action: BridgeAction) {
  sendAction(tauriTransport, action);
}
