import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "../../../styles/global.css";
import { settings } from "../../../settings/store";
import { language, startLanguage } from "../../../i18n";
import { startThemes } from "../../themes/store";
import { startCrashLog } from "../../window/store";
import { nav, settingsQuery } from "../../../notch/nav";
import { sectionQuery } from "../searchLink";
import { settingsWindow } from "../../../platform/native";
import { followStores } from "../../../lib/bridge";
import { tauriTransport } from "../../../lib/tauriTransport";
import { sharedStores } from "./shared";
import { SettingsWindow } from "./SettingsWindow";

/*
 * Entry of the settings window (settings.html). Loads the settings and what they show, nothing the notch runs: the
 * settings and the other saved stores follow the notch window through localStorage (src/lib/storeCore.ts), and only the
 * notch applies them (src/lib/windowKind.ts).
 */

// The colours and the font come from the theme variables.
startThemes();
startCrashLog();

// A window, not a web page: no browser menu, except in text fields (to paste a key), and no reload or print.
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

// What only the notch knows (update, shortcuts, readings), over the bridge; then the section asked for when the window opened,
// and the ones asked for while it stays open. A section with text from the bar's search opens the window's own search on it.
followStores(tauriTransport, sharedStores);
const go = (section: string) => {
  const query = sectionQuery(section);
  if (query !== null) settingsQuery.set(query);
  nav.set({ tabId: "settings", section: query === null ? section : null });
};
void settingsWindow.takeSection().then((section) => section && go(section));
settingsWindow.onSection(go);

/** Re-renders on a language change, as the notch's root does. */
function App() {
  language.use();
  return (
    <MotionConfig reducedMotion="user">
      <SettingsWindow />
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
