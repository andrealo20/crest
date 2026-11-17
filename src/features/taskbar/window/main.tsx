import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "../../../styles/global.css";
import { settings } from "../../../settings/store";
import { language, startLanguage } from "../../../i18n";
import { startThemes } from "../../themes/store";
import { startCrashLog } from "../../window/store";
import { startBarWindows } from "../store";
import { TaskbarWindow } from "./TaskbarWindow";

/*
 * Entry of the bar's window (taskbar.html, src-tauri/src/taskbar/bar.rs). Loads the settings and the open windows, nothing the
 * notch runs: the settings follow the notch window through localStorage (src/lib/storeCore.ts), and only the notch applies them
 * (src/lib/windowKind.ts). The open windows come as Rust events, so the page does nothing while they do not change.
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
