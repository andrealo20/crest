import type { WindowKind } from "../lib/windowKind";

/** Where a `navigate` goes: the open panel of this window, the settings window, or the notch from another window. */
export type NavRoute = "panel" | "settings-window" | "notch";

/**
 * In the app the settings live in their own window and every tool in the notch. The browser demo keeps it all in the panel,
 * but with its desktop (`demoWindow`, src/dev/demoBar.tsx) the settings open in a window over it, as in the app.
 */
export function navRoute(tabId: string, kind: WindowKind, native: boolean, demoWindow = false): NavRoute {
  if (!native) return demoWindow && tabId === "settings" ? "settings-window" : "panel";
  if (tabId === "settings") return "settings-window";
  if (kind !== "notch") return "notch";
  return "panel";
}
