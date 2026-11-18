import { askNotch } from "../../lib/tauriTransport";
import { isNotchWindow } from "../../lib/windowKind";
import { useEffect } from "react";
import { createStore } from "../../lib/store";
import { rowVisible } from "../../notch/row/visibility";
import { fetchLeetcode, type LeetcodeStats } from "../../platform/services";
import { settings } from "../../settings/store";
import { barPanels, barShows } from "../taskbar/barPanels";

/** Rust caches for an hour; asking more often would only return the cache. */
const POLL_MS = 3_600_000;

/** State shared by the LeetCode tool tab and the closed-row part. */
export const leetcode = createStore<{
  data: LeetcodeStats | null;
  error: string | null;
  loading: boolean;
}>({
  data: null,
  error: null,
  loading: false,
});

const viewers = createStore(0);
let timer: ReturnType<typeof setInterval> | null = null;
let timerUser = "";
let latest = 0;
let askedUser = "";
const RETRY_MS = 4 * 60_000;
let retry: ReturnType<typeof setTimeout> | null = null;
let retried = false;

export function refreshLeetcode(force = false): Promise<void> {
  if (!isNotchWindow) {
    askNotch({ kind: "refresh", what: "leetcode", force });
    return Promise.resolve();
  }
  const call = ++latest,
    user = settings.get().leetcode.user.trim();
  askedUser = user.toLowerCase();
  leetcode.set((g) => ({ ...g, loading: true }));
  return fetchLeetcode(user, force).then(
    (data) => {
      if (call !== latest) return;
      retried = false;
      leetcode.set({ data, error: null, loading: false });
    },
    (e) => {
      if (call !== latest) return;
      const drop = e === "not-found" || e === "no-user";
      leetcode.set((g) => ({
        data: drop ? null : g.data,
        error: String(e),
        loading: false,
      }));
      if (!retried && !retry && e !== "no-user") {
        retried = true;
        retry = setTimeout(() => {
          retry = null;
          if (wanted()) void refreshLeetcode();
        }, RETRY_MS);
      }
    },
  );
}

function wanted(): boolean {
  const s = settings.get();
  const closedOn = Boolean(
    (s.closed.parts as Record<string, boolean>).leetcode,
  );
  return (
    !!s.leetcode.user.trim() &&
    ((closedOn && rowVisible.get()) || viewers.get() > 0)
  );
}

function apply() {
  const user = settings.get().leetcode.user.trim();
  if (!wanted()) {
    if (timer) clearInterval(timer);
    timer = null;
    if (retry) clearTimeout(retry);
    retry = null;
    if (!user && (leetcode.get().data || leetcode.get().error)) {
      latest++;
      askedUser = "";
      leetcode.set({ data: null, error: null, loading: false });
    }
    return;
  }
  if (timer && timerUser === user) return;
  if (timer) clearInterval(timer);
  const { data, loading } = leetcode.get();
  if (askedUser !== user.toLowerCase()) {
    retried = false;
    leetcode.set({ data: null, error: null, loading: false });
    void refreshLeetcode();
  } else if (!loading && (!data || Date.now() - data.fetchedAt >= POLL_MS)) {
    void refreshLeetcode();
  }
  timer = setInterval(() => void refreshLeetcode(), POLL_MS);
  timerUser = user;
}

export function startLeetcode() {
  apply();
  settings.subscribe(apply);
  rowVisible.subscribe(apply);
  viewers.subscribe(apply);
  // A bar's panel showing LeetCode counts as one more open view, so the notch fetches for it; barPanels also notifies unchanged values.
  let barShown = false;
  barPanels.subscribe(() => {
    if (barShows("leetcode") === barShown) return;
    barShown = !barShown;
    viewers.set((n) => n + (barShown ? 1 : -1));
  });
}

/** For views that show LeetCode stats: triggers polling while mounted. */
export function useLeetcodeViewer() {
  useEffect(() => {
    viewers.set((n) => n + 1);
    return () => viewers.set((n) => n - 1);
  }, []);
}
