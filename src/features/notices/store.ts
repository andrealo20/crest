import { createStore } from "../../lib/store";
import { noticeSource, systemControls, type IncomingNotice, type NoticeSourceStatus } from "../../platform/services";
import { settings, updateSettings } from "../../settings/store";
import { presentingNow, privacy } from "../privacy/store";
import { fullscreen } from "../system/gaming";
import { addNotice, removeApp, removeNotice, type Notice } from "./history";
import { rememberApp, route, setRule, type NoticeRule } from "./rules";

/*
 * Live notices: every notice from Rust (`notices://in`) goes through the app's rule, quiet hours and presentation
 * mode, into the history, and pops up in the closed notch when nothing keeps it quiet. The history lives in memory
 * only: notification texts are never written to disk.
 */

/** How long a notice stays in the closed notch. */
export const POP_MS = 6000;

export const history = createStore<Notice[]>([]);
/** The notice showing in the closed notch now (NoticeLayer). */
export const popping = createStore<Notice | null>(null);
export const sourceStatus = createStore<NoticeSourceStatus>({ access: "unspecified", mode: "off", pipe: false, pipeFailed: false });

let popTimer: number | undefined;
let nextId = 0;

// Notices wait for each other here, so reading the focus state cannot reorder them.
let queue = Promise.resolve();

function receive(input: IncomingNotice) {
  if (!settings.get().notices.enabled) return;
  // Read when a notice arrives instead of polling; a failed read counts as focus off.
  queue = queue.then(() => systemControls.focus().then((f) => f.active, () => false).then((focus) => ingest(input, focus))).catch(console.error);
}

function ingest(input: IncomingNotice, focus: boolean) {
  const s = settings.get().notices;
  if (!s.enabled) return;
  const apps = rememberApp(s.apps, input.appId, input.appName);
  if (apps !== s.apps) updateSettings((cur) => ({ notices: { ...cur.notices, apps } }));
  const d = new Date();
  const where = route(input.appId, s, { presenting: presentingNow(), now: d.getHours() * 60 + d.getMinutes(), fullscreen: fullscreen.get(), focus });
  if (where === "drop") return;
  const n: Notice = { ...input, id: `${Date.now()}-${nextId++}` };
  history.set((list) => addNotice(list, n, Date.now()));
  // The newest notice takes the closed notch; an update with the same replace key refreshes it there.
  if (where === "pop") pop(n);
}

function pop(n: Notice) {
  popping.set(n);
  window.clearTimeout(popTimer);
  popTimer = window.setTimeout(() => popping.set(null), POP_MS);
}

export function dismissPop() {
  window.clearTimeout(popTimer);
  popping.set(null);
}

export function deleteNotice(id: string) {
  history.set((list) => removeNotice(list, id));
  if (popping.get()?.id === id) dismissPop();
}

export function clearHistory() {
  history.set([]);
  dismissPop();
}

export function setAppRule(appId: string, rule: NoticeRule) {
  updateSettings((cur) => ({ notices: { ...cur.notices, rules: setRule(cur.notices.rules, appId, rule) } }));
  if (rule === "hide") {
    history.set((list) => removeApp(list, appId));
    if (popping.get()?.appId.toLowerCase() === appId.toLowerCase()) dismissPop();
  }
}

/** Windows refused the access request itself (no prompt); the settings then point to Windows Settings. */
export const requestFailed = createStore(false);

/** Asks Windows for access to notifications (its prompt shows only the first time). */
export async function requestAccess() {
  const access = await noticeSource.requestAccess();
  requestFailed.set(access === "request-failed");
  if (access !== "request-failed") sourceStatus.set((s) => ({ ...s, access }));
}

/** Reads the sources' state again (the settings page does this when it opens). */
export function refreshStatus() {
  void noticeSource.status().then((s) => sourceStatus.set(s));
}

let started = false;

/** Listens for notices and switches the Rust sources with the settings. */
export function startNotices() {
  if (started) return;
  started = true;
  noticeSource.onNotice(receive);
  noticeSource.onStatus((s) => sourceStatus.set(s));
  refreshStatus();
  // A notice on screen goes as soon as presentation mode starts or an app goes fullscreen.
  const hideWhenPresenting = () => (presentingNow() || fullscreen.get()) && popping.get() && dismissPop();
  privacy.subscribe(hideWhenPresenting);
  settings.subscribe(hideWhenPresenting);
  fullscreen.subscribe(hideWhenPresenting);

  let last = "";
  const apply = () => {
    const { enabled, windows, cli } = settings.get().notices;
    const key = `${enabled && windows}|${enabled && cli}`;
    if (key === last) return;
    last = key;
    noticeSource.configure(enabled && windows, enabled && cli);
    // Switched off: nothing of what was read stays on screen or in memory.
    if (!enabled) clearHistory();
  };
  apply();
  settings.subscribe(apply);
}

/** Master switch. Turning it on also shows the history page in the tool bar. */
export function setNoticesEnabled(on: boolean) {
  updateSettings((cur) => ({
    notices: { ...cur.notices, enabled: on },
    tools: on ? cur.tools.map((t) => (t.id === "notices" ? { ...t, enabled: true } : t)) : cur.tools,
  }));
}
