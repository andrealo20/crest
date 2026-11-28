import { askNotch } from "../../lib/tauriTransport";
import { isNotchWindow } from "../../lib/windowKind";
import { createStore } from "../../lib/store";
import { noWinApis } from "../../platform/native";
import { keepAwake } from "../../platform/services";
import { awakeStart, type Awake } from "./awake";

/** Keep awake; never saved, so Crest always starts with it off. */
export const awake = createStore<Awake>(null);

let ends: number | undefined;

/** On for `minutes` (null = until turned off). The backend ends a timed one by itself; this only follows. */
export function startAwake(minutes: number | null) {
  // Only the notch holds the state and may set it in Rust (the bar and the settings window may not): another window asks the
  // notch, whose request handler calls this function there (src/features/settings/window/shared.ts).
  if (!isNotchWindow) return askNotch({ kind: "awake", minutes });
  const next = awakeStart(minutes, Date.now());
  awake.set(next);
  window.clearTimeout(ends);
  if (next?.endsAt != null) ends = window.setTimeout(() => awake.set(null), next.endsAt - Date.now());
  void keepAwake(true, minutes).catch(() => stopAwake());
}

export function stopAwake() {
  if (!isNotchWindow) return askNotch({ kind: "awakeOff" });
  window.clearTimeout(ends);
  awake.set(null);
  if (!noWinApis) void keepAwake(false, null).catch(() => {});
}

// A reloaded notch starts off, so the backend must too. Another window loading must not end the notch's keep-awake.
if (!noWinApis && isNotchWindow) void keepAwake(false, null).catch(() => {});
