import type { RestoreResult } from "../../../lib/backup";
import { onActions, shareStores, type BridgeAction, type Shared } from "../../../lib/bridge";
import { settingsClosedActions } from "../../../lib/bridgeRules";
import { restoreResult } from "../../../lib/restorePending";
import { createStore } from "../../../lib/store";
import { tauriTransport } from "../../../lib/tauriTransport";
import { checkForUpdate, installUpdate, update } from "../../../lib/update";
import { isNotchWindow } from "../../../lib/windowKind";
import { closedEdit } from "../../../notch/ClosedResize";
import { liveSupport } from "../../../notch/glass/live";
import { monitor, monitors } from "../../../notch/monitor";
import { pinned } from "../../../notch/useNotchState";
import { isNative, settingsWindow } from "../../../platform/native";
import { backupFiles } from "../../../platform/services";
import { vault } from "../../../platform/vault";
import { calendar, refreshCalendar } from "../../calendar/store";
import { discordState, reconnectDiscord } from "../../discord/store";
import { github, refreshGithub } from "../../github/store";
import { hotkeysResting, shortcutResult } from "../../launcher/store";
import { leetcode, refreshLeetcode } from "../../leetcode/store";
import { clearHistory, deleteNotice, refreshStatus, sourceStatus } from "../../notices/store";
import { syncOfflineStatus } from "../../now-playing/offlineEngine";
import { startAwake, stopAwake } from "../../overview/store";
import { plugins, refreshPlugins } from "../../plugins/store";
import { privacy, snoozed, togglePresentation } from "../../privacy/store";
import { system } from "../../system/store";
import { runInTerminal } from "../../terminal/session";
import { focusMuted, timerActions } from "../../timer/store";
import { refreshUsage } from "../../usage/store";
import { hotkeyStatus, pauseHotkeys, toolHotkeyStatus } from "../../window/store";

/*
 * What the settings window shows from the notch's memory. Only the notch's start functions fill these stores (update checks,
 * shortcut registration, readings, the monitor the notch is on), so the settings window takes them over the bridge
 * (src/lib/bridge.ts). Without them it would show Discord as off, hide the glass switches and size the closed notch on its own
 * screen.
 */

/** The restore applied when the notch started (BackupSettings shows it); the settings window gets it over the bridge. */
export const restored = createStore<RestoreResult>(restoreResult);

export const sharedStores: Record<string, Shared> = {
  update,
  hotkeyStatus,
  toolHotkeyStatus,
  shortcutResult,
  hotkeysResting,
  privacy,
  snoozed,
  github,
  leetcode,
  calendar,
  system,
  plugins,
  discordState,
  liveSupport,
  monitor,
  monitors,
  restored,
  sourceStatus,
};

/** A request from the settings window or the bar, carried out here in the notch by the function the window called. */
function run(action: BridgeAction) {
  switch (action.kind) {
    case "pauseHotkeys":
      return pauseHotkeys(action.on);
    case "closedEdit":
      return closedEdit.set(true);
    case "presentation":
      return togglePresentation();
    case "checkUpdate":
      return void checkForUpdate();
    case "installUpdate":
      return void installUpdate();
    case "restart":
      return void backupFiles.restart();
    case "lockVault":
      // No vault on a Mac: its command is missing there.
      return void vault.lock().catch(() => {});
    case "refresh":
      return void refreshers[action.what](action.force);
    case "awake":
      return startAwake(action.minutes);
    case "awakeOff":
      return stopAwake();
    case "renewClaude":
      runInTerminal("claude");
      return void settingsWindow.notchOpen("terminal");
    case "noticeDelete":
      return deleteNotice(action.id);
    case "noticesClear":
      return clearHistory();
    case "timerSilence":
      return timerActions.silence();
    case "focusMute":
      return focusMuted.set(action.on);
  }
}

const refreshers: Record<Extract<BridgeAction, { kind: "refresh" }>["what"], (force?: boolean) => unknown> = {
  usage: refreshUsage,
  github: refreshGithub,
  leetcode: refreshLeetcode,
  calendar: refreshCalendar,
  discord: reconnectDiscord,
  plugins: refreshPlugins,
  offline: syncOfflineStatus,
  notices: refreshStatus,
};

/**
 * Notch side, in the app only: shares the stores with the settings window and carries out its requests. The sharing waits for
 * the window's hello from the start (the page loads while Rust is still placing the window, so a hello can come before
 * "settings-window://open"), and a closed window ends it, so no change is sent while none is open.
 */
export function startSettingsBridge() {
  if (!isNative || !isNotchWindow) return;
  let stop = shareStores(tauriTransport, sharedStores);
  onActions(tauriTransport, run);
  tauriTransport.listen("settings-window://open", (open) => {
    // The window takes the focus: a pinned notch closes as it opens.
    if (open === true) return pinned.set(false);
    if (open !== false) return;
    // A window closed while recording a shortcut would leave the others paused.
    settingsClosedActions().forEach(run);
    stop();
    stop = shareStores(tauriTransport, sharedStores);
  });
}
