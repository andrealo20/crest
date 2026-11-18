import { createStore } from "../../lib/store";
import { settingsWindow } from "../../platform/native";
import { taskbar } from "../../platform/services";
import { opensInBar, panelKey, sameAnchor, sameContent, type OpenPanel, type PanelAnchor, type PanelContent, type QuickPage } from "./panelModel";

/*
 * The panel above the bar, in the bar's window: what it shows and the item it opens over. The bar's items open it only through the
 * functions below, so where a content opens (here or in the notch) and when the keyboard goes back are decided in one place.
 */

export type { OpenPanel, PanelAnchor, PanelContent };

/** The open panel, null while it is closed. */
export const panel = createStore<OpenPanel | null>(null);

/**
 * A tray icon dragged off the bar or out of the tray panel (Tray.tsx), by its `TrayIcon.id` and picture key, and the pointer, in the
 * window's CSS px; null while none is. The bar draws the icon under the pointer and keeps it visible or hides it where it is let go,
 * and the panel lets the window take the pointer meanwhile.
 */
export const trayDrag = createStore<{ id: string; img: string | null; x: number; y: number; from: "panel" | "bar" } | null>(null);

/** The quick panel's rows that come and go (QuickPanel.tsx), for its size (QUICK_SIZE): the radios, the brightness, the open output list's px. */
export const quickLayout = createStore<{ radios: boolean; brightness: boolean; list: number }>({ radios: true, brightness: false, list: 0 });

/** The page open in the quick panel and the rows it asks room for (QUICK_PAGE_SIZE), null on the main page; the panel reopens on the main page. */
export const quickPage = createStore<{ page: QuickPage; rows: number; extra: number } | null>(null);

/** While Windows' own prompt has the focus, the panel stays open when its window loses it. */
export const panelHeld = createStore(false);

/** Opens the panel over `anchor`, or puts `content` in its place when it is open. A tool the bar cannot show opens in the notch. */
export function openPanel(content: PanelContent, anchor: PanelAnchor): void {
  if (content.kind === "tool" && !opensInBar(content)) {
    closePanel();
    void settingsWindow.notchOpen(content.tool);
    return;
  }
  panel.set({ content, anchor });
}

/**
 * The second click on an item closes what it opened and gives the keyboard back to the app that had it, even if the item shifted or
 * changed width meanwhile (its span still overlaps the one it opened from). Any other content opens, and so does the same content from
 * another item (several open the same tool): the panel moves over that item.
 */
export function togglePanel(content: PanelContent, anchor: PanelAnchor): void {
  const open = panel.get();
  if (!open || !sameContent(open.content, content) || !sameAnchor(open.anchor, anchor)) return openPanel(content, anchor);
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
