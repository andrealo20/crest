import { createStore } from "../../lib/store";
import { settingsWindow } from "../../platform/native";
import { taskbar } from "../../platform/services";
import { opensInBar, panelKey, sameContent, type OpenPanel, type PanelAnchor, type PanelContent } from "./panelModel";

/*
 * The panel above the bar, in the bar's window: what it shows and the item it opens over. The bar's items open it only through the
 * functions below, so where a content opens (here or in the notch) and when the keyboard goes back are decided in one place.
 */

export type { OpenPanel, PanelAnchor, PanelContent };

/** The open panel, null while it is closed. */
export const panel = createStore<OpenPanel | null>(null);

/** Opens the panel over `anchor`, or puts `content` in its place when it is open. A tool the bar cannot show opens in the notch. */
export function openPanel(content: PanelContent, anchor: PanelAnchor): void {
  if (content.kind === "tool" && !opensInBar(content)) {
    closePanel();
    void settingsWindow.notchOpen(content.tool);
    return;
  }
  panel.set({ content, anchor });
}

/** The second click on an item closes what it opened and gives the keyboard back to the app that had it; any other content opens. */
export function togglePanel(content: PanelContent, anchor: PanelAnchor): void {
  const open = panel.get();
  if (!open || !sameContent(open.content, content)) return openPanel(content, anchor);
  closePanel();
  void taskbar.release();
}

/** Closes the panel. The keyboard stays where it is: with whatever took the click that closed it, or with an app just started. */
export function closePanel(): void {
  panel.set(null);
}

/** Tells the notch what the panel shows each time that changes (`bar://panel`), so it runs what a tool open here needs from it. */
export function startPanelReport(): void {
  let last: string | null = null;
  panel.subscribe(() => {
    const open = panel.get();
    const key = open && panelKey(open.content);
    if (key === last) return;
    last = key;
    void taskbar.panel(key);
  });
}
