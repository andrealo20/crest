import { createStore } from "../../lib/store";
import { noticeSource, systemControls, windowShell, type IncomingNotice, type NoticeSourceStatus } from "../../platform/services";
import { focusMode } from "../../notch/focus";
import { settings, updateSettings } from "../../settings/store";
import { presentingNow, privacy } from "../privacy/store";
import { fullscreen } from "../system/gaming";
import { screen } from "../window/store";
import { addNotice, removeApp, removeNotice, removeToasts, type Notice } from "./history";
import { rememberApp, route, ruleFor, setRule, type NoticeRule } from "./rules";
import { applyPart, livePart, nextExpiry, type PartMessage, type ScriptPart } from "./scriptParts";
import { addAsk, removeAsk, type Ask } from "./asks";

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

/** Custom closed-row parts from `crest-notify part` (the "script" part draws them). */
export const scriptParts = createStore<ScriptPart[]>([]);
let partTimer: number | undefined;

function receivePart(m: PartMessage) {
  scriptParts.set((list) => applyPart(list, m, Date.now()));
  schedulePrune();
}

function schedulePrune() {
  window.clearTimeout(partTimer);
  const at = nextExpiry(scriptParts.get());
  if (at === null) return;
  partTimer = window.setTimeout(() => {
    scriptParts.set((list) => list.filter(livePart(Date.now())));
    schedulePrune();
  }, Math.max(0, at - Date.now()) + 50);
}

/** Questions from `crest-notify ask`, oldest first; the first one shows in the closed notch until answered. */
export const asks = createStore<Ask[]>([]);

/*
 * An ask is work the user started, so quiet hours, focus and full screen do not hold it back, and it stays until
 * answered. It is not kept in the history. Off for its source, while presenting (its text could be a command on a
 * shared screen), or when nothing can show it (focus mode as a line, the window hidden by a rule or the shortcut),
 * it is answered "no choice" at once, so the caller falls back to its own prompt without waiting.
 */
let windowHidden = false;

function receiveAsk(a: Ask) {
  const s = settings.get().notices;
  const unseen = windowHidden || screen.get() === "hide" || (focusMode.get() && settings.get().display.focusStyle === "line");
  if (!s.enabled || ruleFor(s.rules, a.appId) === "hide" || presentingNow() || unseen) return noticeSource.answer(a.id, null);
  const apps = rememberApp(s.apps, a.appId, a.appName);
  if (apps !== s.apps) updateSettings((cur) => ({ notices: { ...cur.notices, apps } }));
  asks.set((list) => addAsk(list, a));
}

/** A click on an option, or null when the question was closed without one. */
export function answerAsk(id: number, choice: string | null) {
  asks.set((list) => removeAsk(list, id));
  noticeSource.answer(id, choice);
}

/** A notice from a plugin that may show them; it goes through the same rules, quiet hours and history. */
export const receivePluginNotice = (input: IncomingNotice) => receive(input);

function receive(input: IncomingNotice) {
  if (!settings.get().notices.enabled) return;
  // Read when a notice arrives instead of polling; a failed read counts as focus off.
  queue = queue.then(() => systemControls.focus().then((f) => f.active, () => false).then((focus) => ingest(input, focus))).catch(console.error);
}

function ingest(input: IncomingNotice, focus: boolean) {
  const s = settings.get().notices;
  if (!s.enabled) return;
  const apps = rememberApp(s.apps, input.appId, input.appName);
  // A new app: its first notice already had its Windows banner, the next ones only pop up here (syncBanners).
  if (apps !== s.apps) updateSettings((cur) => ({ notices: { ...cur.notices, apps } }));
  else if (input.source === "windows") syncBanners(true);
  const d = new Date();
  const where = route(input.appId, s, { presenting: presentingNow(), now: d.getHours() * 60 + d.getMinutes(), fullscreen: fullscreen.get(), focus });
  if (where === "drop") return;
  const n: Notice = { ...input, id: `${Date.now()}-${nextId++}` };
  history.set((list) => addNotice(list, n, Date.now()));
  // The newest notice takes the closed notch; an update with the same replace key refreshes it there.
  if (where === "pop") pop(n);
}

/*
 * Windows' banners stay off only while Crest pops the notices up itself: turning off live notices or the Windows
 * source, Windows taking the access back or the source failing brings them back, so nothing is left without any
 * banner. Only apps whose rule is "show" lose theirs. banners.rs marks what it turned off.
 */
let bannersKey: string | null = null;
let statusSeen = false;
function syncBanners(again = false) {
  const n = settings.get().notices, st = sourceStatus.get();
  const wanted = n.enabled && n.windows && n.hideBanners;
  // Before the first status, or while the source is still starting, its state is unknown: wait rather than give the
  // banners back for a moment.
  if (wanted && (!statusSeen || (st.access === "allowed" && st.mode === "off"))) return;
  const hide = wanted && st.access === "allowed" && st.mode !== "failed";
  const apps = hide ? Object.keys(n.apps).filter((a) => ruleFor(n.rules, a) === "show") : [];
  const key = `${hide}|${apps.join("\n")}`;
  // `again`: an app Windows gave a fresh key (reinstalled, reset) is hidden again; Rust skips the ones already hidden.
  if (key === bannersKey && !(again && hide)) return;
  bannersKey = key;
  void noticeSource.banners(hide, apps).catch((e: unknown) => {
    // The Store build cannot change Windows' settings and opened them for the user instead: the switch goes back off.
    if (hide && String(e) === "settings") updateSettings((cur) => ({ notices: { ...cur.notices, hideBanners: false } }));
  });
}
settings.subscribe(() => syncBanners());
sourceStatus.subscribe(() => {
  statusSeen = true;
  syncBanners();
});
syncBanners();

function pop(n: Notice) {
  popping.set(n);
  window.clearTimeout(popTimer);
  popTimer = window.setTimeout(() => popping.set(null), POP_MS);
}

export function dismissPop() {
  window.clearTimeout(popTimer);
  popping.set(null);
}

/** Ids Windows gave these notices' toasts, for removing them from the notification centre too. */
const windowsIds = (list: Notice[]) => list.flatMap((n) => (n.source === "windows" && typeof n.windowsId === "number" ? [n.windowsId] : []));

export function deleteNotice(id: string) {
  noticeSource.removeWindows(windowsIds(history.get().filter((n) => n.id === id)));
  history.set((list) => removeNotice(list, id));
  if (popping.get()?.id === id) dismissPop();
}

/*
 * The other way round: a toast that left the notification centre leaves Crest too, say once its app withdrew it
 * because the message was read there (issue #30). In the queue, so a toast withdrawn right after it came in is not
 * added back by the notice still on its way.
 */
function forgetToasts(ids: number[]) {
  queue = queue
    .then(() => {
      history.set((list) => removeToasts(list, ids));
      const shown = popping.get();
      if (shown && !history.get().includes(shown)) dismissPop();
    })
    .catch(console.error);
}

export function clearHistory() {
  noticeSource.removeWindows(windowsIds(history.get()));
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
  noticeSource.onToastsGone(forgetToasts);
  noticeSource.onStatus((s) => sourceStatus.set(s));
  noticeSource.onPart(receivePart);
  noticeSource.onAsk(receiveAsk);
  noticeSource.onAskClosed((id) => asks.set((list) => removeAsk(list, id)));
  windowShell.onHidden((hidden) => (windowHidden = hidden));
  refreshStatus();
  // A notice on screen goes as soon as presentation mode starts or an app goes fullscreen; open questions go when presenting starts.
  const hideWhenPresenting = () => {
    if ((presentingNow() || fullscreen.get()) && popping.get()) dismissPop();
    if (presentingNow()) asks.get().forEach((a) => answerAsk(a.id, null));
  };
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
    // Switched off: nothing of what was read stays on screen or in memory, but the action centre is left alone.
    if (!enabled) {
      history.set([]);
      dismissPop();
    }
    // Rust answers the open questions "no choice" when the channel closes.
    if (!(enabled && cli)) {
      scriptParts.set([]);
      asks.set([]);
    }
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
