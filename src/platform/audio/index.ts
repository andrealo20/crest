import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isNotchWindow } from "../../lib/windowKind";
import { isNative } from "../native";

export type Levels = [number, number, number, number];
type Listener<T> = (levels: T) => void;

/*
 * Real levels from the Rust loopback (src-tauri/src/audio.rs): 4 bands as `audio://levels`, 12 thinner
 * ones as `audio://spectrum`. Capture only runs while at least one visible equalizer asks for either.
 * Only the notch turns it on and off: the bar's window may not call `audio_levels`, so it listens while the notch captures for it.
 * Rust hands each reading only to the windows listening for it, so a window listens only while it draws bars.
 */
const channels = new Map<string, { listeners: Set<Listener<never>>; unlisten: Promise<() => void> }>();
let wanted = 0;

export const audioLevelsAvailable = isNative;

function subscribe<T>(event: string, listener: Listener<T>): () => void {
  if (!isNative) return () => {};
  let channel = channels.get(event);
  if (!channel) {
    const listeners = new Set<Listener<T>>();
    channel = { listeners, unlisten: listen<T>(event, (e) => listeners.forEach((l) => l(e.payload))) };
    channels.set(event, channel);
  }
  const own = channel;
  own.listeners.add(listener);
  const release = want();
  return () => {
    own.listeners.delete(listener);
    if (own.listeners.size === 0 && channels.get(event) === own) {
      channels.delete(event);
      void own.unlisten.then((f) => f());
    }
    release();
  };
}

function want(): () => void {
  wanted++;
  if (wanted === 1 && isNotchWindow) void invoke("audio_levels", { enabled: true });
  return () => {
    wanted--;
    if (wanted === 0 && isNotchWindow) void invoke("audio_levels", { enabled: false });
  };
}

/** Keeps the capture on for equalizers in another window (the bar's) without sending the readings to this one. */
export const holdLevels = (): (() => void) => (isNative ? want() : () => {});

export const subscribeLevels = (listener: Listener<Levels>) => subscribe("audio://levels", listener);
export const subscribeSpectrum = (listener: Listener<number[]>) => subscribe("audio://spectrum", listener);
