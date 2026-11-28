import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "../../../styles/global.css";
import { settings } from "../../../settings/store";
import { language, startLanguage } from "../../../i18n";
import { receiveLive, restartLive, startGlassLive } from "../../../notch/glass/live";
import { isNative, onSharedBuffer, noWinApis } from "../../../platform/native";
import { startThemes } from "../../themes/store";
import { startCrashLog } from "../../window/store";
import { taskbar } from "../../../platform/services";
import { startPanelReport } from "../panel";
import { followBar, startBarWindows } from "../store";
import { startDecor } from "../tray";
import { TaskbarWindow, primary } from "./TaskbarWindow";

/*
 * Entry of the bar's window (taskbar.html, src-tauri/src/taskbar/bar.rs). Loads the settings and the open windows, follows whether
 * the bar shows, and in the primary bar follows what the notch sends it (barStores.ts: the widgets' data, the panel's stores); in dev in the browser, where
 * no notch runs, sample data stands in. Nothing the notch runs: the settings follow the notch window through localStorage
 * (src/lib/storeCore.ts), and only the notch applies them (src/lib/windowKind.ts). The windows and the data come as events, so the
 * page does nothing while they do not change.
 */

// The colours and the font come from the theme variables.
startThemes();
startCrashLog();

// A window, not a web page: no browser menu, except in text fields, and no reload or print.
window.addEventListener("contextmenu", (e) => {
  if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) e.preventDefault();
});
// WebView2 would open a dropped file or link in this window; nothing can be dropped here but files on the apps, whose own
// handler ran first.
window.addEventListener("dragover", (e) => {
  if (e.defaultPrevented) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
});
window.addEventListener("drop", (e) => e.preventDefault());
window.addEventListener("keydown", (e) => {
  if (e.key === "F5" || e.key === "F7" || e.key === "F12" || (e.ctrlKey && ["r", "p", "f", "j", "u", "s"].includes(e.key.toLowerCase()))) e.preventDefault();
});

startBarWindows();
startDecor();
// A reloaded page starts with its panel closed: the notch forgets what the page before it had open.
void taskbar.panel(null);
// Nor does it keep the window previews the page before it showed (Preview.tsx).
void taskbar.preview([]).catch(() => {});
startPanelReport();
// Whether this bar shows, in every bar (its glass stops while Rust hides it); the notch's data, in the primary only.
followBar(primary);
// In the browser no notch feeds the widgets: sample data, in dev only, so they can be checked as they draw.
if (import.meta.env.DEV && !isNative) void import("../../../dev/barSample").then((m) => m.fillSample());

// The bar's live glass (BarGlass.tsx), behind its own switch; in the browser ?glassLive stands in for Rust, as for the notch. Only the
// live frames come through the shared buffers here, and this is the page's one listener: snapshot.ts, loaded with the panel's
// NotchShape, listens only where the notch starts it.
startGlassLive(() => settings.get().taskbar.glass);
if (isNative && !noWinApis) {
  onSharedBuffer((meta, data) => {
    if ((meta as { kind?: unknown } | null)?.kind === "glass-live") receiveLive(meta, data);
  });
  // The copy's zone is in the window, its capture in the monitor: the bar moved with the work area, a new session.
  void getCurrentWindow().onMoved(restartLive);
}

/** Re-renders on a language change, as the notch's root does. */
function App() {
  language.use();
  return (
    <MotionConfig reducedMotion="user">
      <TaskbarWindow />
    </MotionConfig>
  );
}

void startLanguage(settings).then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
