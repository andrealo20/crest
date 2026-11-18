import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "../../../styles/global.css";
import { settings } from "../../../settings/store";
import { language, startLanguage } from "../../../i18n";
import { isNative } from "../../../platform/native";
import { startThemes } from "../../themes/store";
import { startCrashLog } from "../../window/store";
import { followNotch, startBarWindows } from "../store";
import { TaskbarWindow, primary } from "./TaskbarWindow";

/*
 * Entry of the bar's window (taskbar.html, src-tauri/src/taskbar/bar.rs). Loads the settings and the open windows, and in the
 * primary bar follows what the notch sends it (barStores.ts: the widgets' data, the panel's stores); in dev in the browser, where
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
// WebView2 would open a dropped file or link in this window; nothing can be dropped here.
window.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
});
window.addEventListener("drop", (e) => e.preventDefault());
window.addEventListener("keydown", (e) => {
  if (e.key === "F5" || e.key === "F7" || e.key === "F12" || (e.ctrlKey && ["r", "p", "f", "j", "u", "s"].includes(e.key.toLowerCase()))) e.preventDefault();
});

startBarWindows();
// The notch sends its data to the primary bar only; another bar's hello would have it send everything there again.
if (primary) followNotch();
// In the browser no notch feeds the widgets: sample data, in dev only, so they can be checked as they draw.
if (import.meta.env.DEV && !isNative) void import("../../../dev/barSample").then((m) => m.fillSample());

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
