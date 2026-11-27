import { createStore } from "../lib/store";
import { windowKind } from "../lib/windowKind";
import { isNative, settingsWindow } from "../platform/native";
import { navRoute } from "./navRoute";
import { notchOpen, pinned, stayUntilVisit } from "./useNotchState";

/**
 * Which tool is open? Global so tools can link to each other
 * (e.g. Portfolio without a key → "Connect in settings").
 * `section` scrolls the settings to a section.
 */
export const nav = createStore<{ tabId: string; section: string | null }>({ tabId: "media", section: null });

/** In the Settings window: text the bar's search asked it to look for (settings_window_open's `query`); SettingsView puts it in its field and empties this. */
export const settingsQuery = createStore<string | null>(null);

export function navigate(tabId: string, section: string | null = null) {
  const route = navRoute(tabId, windowKind, isNative);
  // The settings open in their window; the notch keeps the tool it shows. Inside the window, the section reaches the page
  // through Rust (settings/window/main.tsx). Unpinned first: the notch closes when the window takes the focus, and a pinned
  // notch ignores that.
  if (route === "settings-window") {
    pinned.set(false);
    return void settingsWindow.open(section);
  }
  // A tool asked for from another window (a link in the settings) opens in the notch.
  if (route === "notch") return void settingsWindow.notchOpen(tabId);
  // Open, another tool may be smaller and leave the pointer outside it: that must not close the notch (#29).
  if (notchOpen.get() && nav.get().tabId !== tabId) stayUntilVisit();
  nav.set({ tabId, section });
}

/*
 * A click on a closed-notch notice names the tool the notch should open on. It wins over the live activity
 * (a running timer, a call), like the tray entry, but only for the open that follows right away.
 */
let openTarget: { tabId: string; at: number } | null = null;

export function openOn(tabId: string) {
  openTarget = { tabId, at: Date.now() };
  navigate(tabId);
}

/** The tool asked for by `openOn` within the last second, once. */
export function takeOpenTarget(): string | null {
  const t = openTarget;
  openTarget = null;
  return t && Date.now() - t.at < 1000 ? t.tabId : null;
}
