import { isNotchWindow } from "../../lib/windowKind";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/** Is the frontend running in the Tauri app (rather than a regular browser)? */
export const isNative = "__TAURI_INTERNALS__" in window;

/** The settings window (settings_window.rs). In the browser every member does nothing: the demo keeps the settings in the panel. */
export const settingsWindow = {
  /** Opens it, or brings it forward, on `section` (an id of SettingsView's sections). */
  open: (section: string | null): Promise<void> => (isNative ? invoke("settings_window_open", { section }) : Promise.resolve()),
  /** The section asked for when the window opened; the page asks once, when it loads. */
  takeSection: (): Promise<string | null> => (isNative ? invoke<string | null>("settings_window_section") : Promise.resolve(null)),
  /** A section asked for while the window stays open. On this window only: another window's events do not reach it. */
  onSection(handler: (section: string) => void): () => void {
    if (!isNative) return () => {};
    const off = getCurrentWebviewWindow().listen<string>("settings://section", (e) => handler(e.payload));
    return () => void off.then((f) => f());
  },
  /** Opens the notch from another window, on a tool, as the tray does. */
  notchOpen: (tab: string | null): Promise<void> => (isNative ? invoke("notch_open", { tab }) : Promise.resolve()),
};

/** The app on a Mac, where the tools built on Windows APIs are hidden (src/notch/tabs.ts). */
export const isMac = isNative && navigator.userAgent.includes("Mac");

/** The app on Linux. Its tools are the Mac's short list for now; each comes back as its Linux version lands (src-tauri/src/linux/). */
export const isLinux = isNative && /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);

/** A desktop without the Windows APIs most tools are built on: they are hidden here (src/notch/tabs.ts). Mac or Linux. */
export const noWinApis = isMac || isLinux;

/** Reports the hit zone in CSS px relative to the window to Rust (click-through). */
let lastRect = { x: 0, y: 0, w: 0, h: 0 };
export function setHitRect(rect: { x: number; y: number; w: number; h: number }) {
  lastRect = rect;
  if (isNative) void invoke("set_hit_rect", { rect });
}

/** The pet's nest as a second zone that takes the pointer (null: no nest), in the same px as setHitRect. */
export function setPetRect(rect: { x: number; y: number; w: number; h: number } | null) {
  if (isNative) void invoke("set_pet_rect", { rect });
}

/** The pointer came onto the nest or left it; from the Rust poll, since the page sees no pointerleave once the window lets it through. */
export function onPetHover(handler: (inside: boolean) => void): () => void {
  if (!isNative) return () => {};
  const off = listen<boolean>("notch://pet-hover", (e) => handler(e.payload));
  return () => void off.then((f) => f());
}

/** Keeps the window clickable even when the cursor is outside (e.g. while typing). */
export function setPinned(pinned: boolean) {
  if (isNative) void invoke("set_pinned", { pinned });
}

/** How far inside the hit zone the pointer must be to count as entering it, in px. */
const ENTER_INSET = 3;

const domHover = new Set<(inside: boolean) => void>();
const domHoverAt = new Set<(x: number, y: number) => void>();

/**
 * Linux: the window takes the pointer only over the hit zone (its input shape, src-tauri/src/linux/input.rs), so the
 * page sees the pointer enter and leave itself. One pair of listeners serves both callbacks below.
 */
function listenDom(): () => void {
  let inside = false;
  // Pointer events count only after the pointer crossed into the window (GTK's enter, from Rust): WebKit sends the last
  // position again whenever the page changes under a still pointer, and such an echo of the position the pointer just left
  // opened the notch again, which then closed, over and over. True at the start: the pointer may already be over the zone.
  let crossed = true;
  let last: PointerEvent | null = null;
  const set = (now: boolean, e?: PointerEvent) => {
    if (now === inside) return;
    inside = now;
    if (now && e) domHoverAt.forEach((h) => h(e.clientX, e.clientY));
    domHover.forEach((h) => h(now));
  };
  const test = (e: PointerEvent) => {
    const r = lastRect;
    const m = inside ? -1 : ENTER_INSET;
    // Entering needs a crossing first; staying or leaving does not.
    const within = e.clientX >= r.x + m && e.clientX <= r.x + r.w - m && e.clientY >= r.y + m && e.clientY <= r.y + r.h - m;
    set(within && (inside || crossed), e);
  };
  // Inside is decided by where the event is, not by its type. Entering needs the pointer a few px inside the zone and
  // staying only needs it on the zone: the edge pixels are where late events land.
  const move = (e: PointerEvent) => {
    last = e;
    test(e);
  };
  const out = (e: PointerEvent) => {
    if (!e.relatedTarget) set(false);
  };
  const offCrossed = listen("notch://crossed", () => {
    crossed = true;
    // The pointer may have stopped on arriving, with no event after the crossing.
    if (last && !inside && performance.now() - last.timeStamp < 150) test(last);
  });
  // The leave comes from Rust too (GTK's leave-notify, src-tauri/src/linux/input.rs): a pointer that stops moving sends no event.
  const offLeave = listen<boolean>("notch://hover", (e) => {
    if (e.payload) return;
    crossed = false;
    set(false);
  });
  document.addEventListener("pointermove", move, true);
  document.addEventListener("pointerover", move, true);
  document.addEventListener("pointerout", out, true);
  return () => {
    void offLeave.then((f) => f());
    void offCrossed.then((f) => f());
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerover", move, true);
    document.removeEventListener("pointerout", out, true);
  };
}

let offDom: (() => void) | null = null;

/** Adds a handler to one of the sets, with the listeners running while either has one. */
function onDom<T>(set: Set<T>, handler: T): () => void {
  set.add(handler);
  offDom ??= listenDom();
  return () => {
    set.delete(handler);
    if (!domHover.size && !domHoverAt.size) {
      offDom?.();
      offDom = null;
    }
  };
}

/** Cursor over the hit zone; comes from the Rust poll instead of DOM events (on Linux from the DOM, see listenDom). */
export function onNativeHover(handler: (inside: boolean) => void): () => void {
  if (!isNative) return () => {};
  if (isLinux) return onDom(domHover, handler);
  const off = listen<boolean>("notch://hover", (e) => handler(e.payload));
  return () => void off.then((f) => f());
}

/** Where the pointer entered the hit zone, in the page's px; sent just before the hover. */
export function onNativeHoverAt(handler: (x: number, y: number) => void): () => void {
  if (!isNative) return () => {};
  if (isLinux) return onDom(domHoverAt, handler);
  const off = listen<[number, number]>("notch://hover-at", (e) => handler(e.payload[0], e.payload[1]));
  return () => void off.then((f) => f());
}

/** Window lost focus (click into another app). */
export function onNativeBlur(handler: () => void): () => void {
  if (!isNative) return () => {};
  const off = getCurrentWindow().onFocusChanged(({ payload: focused }) => !focused && handler());
  return () => void off.then((f) => f());
}

/** Global shortcut (Ctrl+Alt+Space) was pressed. */
export function onShortcut(handler: () => void): () => void {
  if (!isNative) return () => {};
  const off = listen("notch://shortcut", handler);
  return () => void off.then((f) => f());
}

const trayHandlers = new Set<(tab: string | null) => void>();

/** Browser demo: the host page opens the notch the way the tray does (src/dev/demo.ts). */
export const demoOpen = (tab: string | null) => (trayHandlers.size ? trayHandlers.forEach((h) => h(tab)) : (waiting = { tab }));
let waiting: { tab: string | null } | null = null;

/** Tray: left click / "Open" (tab = null) or "Settings" (tab = "settings"). */
export function onTrayOpen(handler: (tab: string | null) => void): () => void {
  if (!isNative) {
    trayHandlers.add(handler);
    // An open asked for before the notch was there (the demo's first message) happens now.
    if (waiting) {
      const tab = waiting.tab;
      waiting = null;
      queueMicrotask(() => handler(tab));
    }
    return () => void trayHandlers.delete(handler);
  }
  const off = listen<string | null>("notch://open", (e) => handler(e.payload));
  return () => void off.then((f) => f());
}

/**
 * true: the window takes keyboard focus (after opening via shortcut).
 * false: focus goes back to the previous app if we still have it.
 */
export function keyboardFocus(focus: boolean) {
  // The notch's focus only: another window (the Vault's PIN entry in the settings) already has the keyboard.
  if (isNative && isNotchWindow) void invoke("keyboard_focus", { focus });
}

/** WebView2 memory target: low while the notch sits closed, normal otherwise. */
export function setMemoryLow(low: boolean) {
  if (isNative) void invoke("memory_low", { low });
}

/** A copy of the screen behind the window for the glass (capture/backdrop.rs); it comes back as a shared buffer, see onSharedBuffer. */
export function glassBackdrop(seq: number): Promise<void> {
  return isNative ? invoke("glass_backdrop", { seq }) : Promise.reject(new Error("not native"));
}

/** Whether the live glass can run on this PC (capture/glass_live.rs), and if not why: old-windows, arm64, store, unsupported. */
export interface GlassLiveSupport { supported: boolean; reason: string | null }
/** An area of the notch window in whole physical px, the space of the glass's copies (src/notch/glass/params.ts). */
export interface GlassZone { x: number; y: number; w: number; h: number }

/** The live glass's commands (capture/glass_live.rs, src/notch/glass/live.ts); each rejects with a short code. */
export const glassLive = {
  supported: (): Promise<GlassLiveSupport> => invoke("glass_live_supported"),
  exclude: (on: boolean): Promise<void> => invoke("glass_live_exclude", { on }),
  start: (zone: GlassZone): Promise<GlassZone & { gen: number }> => invoke("glass_live_start", { zone }),
  stop: (): Promise<void> => invoke("glass_live_stop"),
};

/** Rust stopped the live copy on its own (`glass://live`): that session's gen, and why. */
export function onGlassLiveStop(handler: (e: { gen: number; reason: string }) => void): () => void {
  if (!isNative) return () => {};
  const off = listen<{ gen: number; reason: string }>("glass://live", (e) => handler(e.payload));
  return () => void off.then((f) => f());
}

/** The session locked, away on a remote client, or the screen asleep or just back (`status://session`), sent when one changes. */
export function onSessionState(handler: (s: { locked: boolean; remote: boolean; asleep: boolean }) => void): () => void {
  if (!isNative) return () => {};
  const off = listen<{ locked: boolean; remote: boolean; asleep: boolean }>("status://session", (e) => handler(e.payload));
  return () => void off.then((f) => f());
}

interface SharedBufferEvent { additionalData: unknown; getBuffer(): ArrayBuffer }
interface SharedBufferHost {
  addEventListener(type: "sharedbufferreceived", listener: (e: SharedBufferEvent) => void): void;
  removeEventListener(type: "sharedbufferreceived", listener: (e: SharedBufferEvent) => void): void;
  releaseBuffer(buffer: ArrayBuffer): void;
}

/** WebView2's shared buffers: `use` gets the buffer's description and its bytes, and the buffer is released right after. */
export function onSharedBuffer(use: (meta: unknown, data: ArrayBuffer) => void): () => void {
  const host = (window as unknown as { chrome?: { webview?: SharedBufferHost } }).chrome?.webview;
  if (!host) return () => {};
  const listener = (e: SharedBufferEvent) => {
    const data = e.getBuffer();
    try {
      use(e.additionalData, data);
    } finally {
      host.releaseBuffer(data);
    }
  };
  host.addEventListener("sharedbufferreceived", listener);
  return () => host.removeEventListener("sharedbufferreceived", listener);
}

/** Focus mode: the window is fully click-through (Rust only counts the clicks that leave it). */
export function setPassthrough(on: boolean) {
  if (isNative) void invoke("set_passthrough", { on });
}

/** The tray menu's texts in the interface language (Rust starts in English). */
export function setTrayTexts(texts: { open: string; settings: string; autostart: string; quit: string }) {
  if (isNative) void invoke("tray_texts", { texts });
}

/** Three quick clicks on the notch in focus mode. */
export function onFocusExit(handler: () => void): () => void {
  if (!isNative) return () => {};
  const off = listen("notch://focus-exit", handler);
  return () => void off.then((f) => f());
}
