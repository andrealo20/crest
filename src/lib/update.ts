import { askNotch } from "./tauriTransport";
import { isNotchWindow } from "./windowKind";
import { createStore } from "./store";
import { settings } from "../settings/store";
import { build, dailyCount, fetchChangelog, updater, type ChangelogEntry, type UpdateHandle } from "../platform/services";
import { isNative } from "../platform/native";
import { countCheck } from "./dailyCount";

/*
 * Updates: check (anonymously, only the latest.json of the newest GitHub release), show the
 * version, download + install only on click. Signed: the app only installs updates with a
 * valid signature (key in tauri.conf.json → plugins.updater.pubkey).
 */

type Phase = "idle" | "checking" | "current" | "available" | "downloading" | "error";

export const update = createStore<{
  current: string | null;
  phase: Phase;
  /** New version, if available. */
  version: string | null;
  progress: number;
  checkedAt: number | null;
  /** Changelog of the new version (all versions, filtered in the UI); null = not loaded. */
  notes: ChangelogEntry[] | null;
  /** The Microsoft Store build: the Store updates it, so there is nothing to check here. */
  store: boolean;
  /** The last download or install failed; the update stays on offer. */
  installFailed: boolean;
}>({ current: null, phase: "idle", version: null, progress: 0, checkedAt: null, notes: null, store: false, installFailed: false });

let found: UpdateHandle | null = null;

export async function checkForUpdate() {
  // The notch keeps what it found, to install it later: the settings window asks it.
  if (!isNotchWindow) return askNotch({ kind: "checkUpdate" });
  // Store policy: the Store build never looks for updates anywhere else, not even on the automatic check.
  if ((await build.info()).store) return;
  const phase = update.get().phase;
  if (phase === "checking" || phase === "downloading") return;
  update.set((s) => ({ ...s, phase: "checking" }));
  try {
    found = await updater.check();
    const version = found?.version ?? null;
    const known = update.get();
    update.set((s) => ({ ...s, phase: found ? "available" : "current", installFailed: false, version, checkedAt: Date.now(), notes: version === known.version ? s.notes : null }));
    if (version && (version !== known.version || !known.notes)) {
      void fetchChangelog(version).then((notes) => update.get().version === version && update.set((s) => ({ ...s, notes })));
    }
  } catch {
    found = null;
    update.set((s) => ({ ...s, phase: "error", checkedAt: Date.now() }));
  }
}

export async function installUpdate() {
  if (!isNotchWindow) return askNotch({ kind: "installUpdate" });
  if (!found || update.get().phase !== "available") return;
  update.set((s) => ({ ...s, phase: "downloading", progress: 0, installFailed: false }));
  try {
    // A portable copy in a folder it can't write only opened the download page: the update stays on offer.
    if ((await found.install((progress) => update.set((s) => ({ ...s, progress })))) === "page") update.set((s) => ({ ...s, phase: "available" }));
  } catch {
    update.set((s) => ({ ...s, phase: "available", installFailed: true }));
  }
}

/** A new version shows within hours; each check is one latest.json of a few KB, so this costs next to nothing. */
const EVERY = 4 * 60 * 60 * 1000;

/** On start (slightly delayed to keep startup fast) and every 4 hours after that, if allowed. */
export function startUpdateWatch() {
  void updater.current().then((current) => update.set((s) => ({ ...s, current })));
  void build.info().then(({ store }) => update.set((s) => ({ ...s, store })));
  const auto = () => settings.get().updates.auto && void checkForUpdate();
  setTimeout(auto, 15_000);
  setInterval(auto, EVERY);
  // Never in the web demo or the showcase (no Tauri there) nor under the dev server.
  if (!isNative || import.meta.env.DEV) return;
  const count = async () => {
    const day = await countCheck(settings.get().updates.count, counted.get().day, new Date(), dailyCount);
    if (day !== counted.get().day) counted.set({ day });
  };
  setTimeout(count, 10_000);
  // Hourly, so a PC left on past midnight UTC counts the new day.
  setInterval(count, 60 * 60 * 1000);
}

/** The last UTC day the daily count was counted on (dailyCount.ts). */
const counted = createStore<{ day: string | null }>({ day: null }, { persist: "dailyCount" });
