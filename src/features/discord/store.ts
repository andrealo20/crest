import { useSyncExternalStore } from "react";
import { askNotch } from "../../lib/tauriTransport";
import { isNotchWindow } from "../../lib/windowKind";
import { createStore } from "../../lib/store";
import { barParts } from "../../notch/row/visibility";
import { discord, type DiscordSnapshot } from "../../platform/services";
import { settings, type Settings } from "../../settings/store";

/** Last state from Rust (`discord://state`). */
export const discordState = createStore<DiscordSnapshot>({ status: "off", error: null, call: null });

/** Whether the Discord tool is on. The bar's Discord widget holds the connection with it off too, so a call can come without it. */
export const discordToolOn = (s: Settings) => s.tools.some((x) => x.id === "discord" && x.enabled);

let started = false;

/** Connects/disconnects when the Discord tool, the bar's Discord widget or the client ID changes. */
export function startDiscord() {
  if (started) return;
  started = true;
  discord.onState((s) => discordState.set(s));
  void discord.state().then((s) => discordState.set(s));

  let last = "";
  const apply = () => {
    const s = settings.get();
    const enabled = discordToolOn(s) || barParts.get().includes("discord");
    const key = `${enabled}|${s.discord.clientId}`;
    if (key === last) return;
    last = key;
    discord.configure(enabled, s.discord.clientId);
  };
  apply();
  settings.subscribe(apply);
  barParts.subscribe(apply);
}

/** Reconnect (e.g. after saving the client secret). */
export function reconnectDiscord() {
  // The notch holds the connection.
  if (!isNotchWindow) return askNotch({ kind: "refresh", what: "discord" });
  const s = settings.get();
  discord.configure(discordToolOn(s) || barParts.get().includes("discord"), s.discord.clientId);
}

export function useDiscordCall() {
  return discordState.use().call;
}

/**
 * One plain value from the state (a boolean, a number, a string), the caller drawn again only when it changes: Rust sends the whole
 * state with every SPEAKING_START and SPEAKING_STOP, several times a second in a lively call.
 */
export const useDiscord = <T extends string | number | boolean | null>(pick: (s: DiscordSnapshot) => T): T =>
  useSyncExternalStore(discordState.subscribe, () => pick(discordState.get()));
