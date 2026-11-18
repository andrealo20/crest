import { createStore } from "../../lib/store";
import { tauriTransport } from "../../lib/tauriTransport";
import { isNotchWindow } from "../../lib/windowKind";
import { isNative } from "../../platform/native";
import { settings } from "../../settings/store";
import { withPanel } from "./panelModel";

/*
 * The notch's side of the bars' panels. A tool open in a bar needs what only the notch does for it (its polls and fetches, the Rust
 * switches only the notch turns on), and the closed notch on the bottom edge steps aside for a bar's panel (Notch.tsx): both read
 * what each bar's panel shows from here.
 */

/** In the notch's window: what each bar's panel shows ("apps" or a tool's id) by the bar window's label; a closed panel has no entry. */
export const barPanels = createStore<Record<string, string>>({});

/** Any bar's panel shows the tool `id`. */
export const barShows = (id: string) => Object.values(barPanels.get()).includes(id);
/** Any bar's panel is open. */
export const anyBarPanel = () => Object.keys(barPanels.get()).length > 0;
/** Any bar's panel shows a tool, not only the app menu. */
export const anyBarTool = () => Object.values(barPanels.get()).some((open) => open !== "apps");

/**
 * Calls `act` only when `barShows(id)` changes, starting from false (`barPanels` notifies unchanged values too), so the notch starts
 * and stops what it runs for a bar's tool once. Returns the unsubscribe.
 */
export function onBarShows(id: string, act: (shown: boolean) => void): () => void {
  let shown = false;
  return barPanels.subscribe(() => {
    if (barShows(id) === shown) return;
    shown = !shown;
    act(shown);
  });
}

/** In the app's notch window only: follows what the bars report through Rust (`taskbar_panel`, src-tauri/src/taskbar/panel.rs). */
export function startBarPanels() {
  if (!isNative || !isNotchWindow) return;
  tauriTransport.listen("bar://panel", (payload) => barPanels.set((s) => withPanel(s, payload)));
  // A bar that goes away cannot report its close: with the bar off, no panel is open.
  settings.subscribe(() => {
    if (!settings.get().taskbar.enabled && anyBarPanel()) barPanels.set({});
  });
}
