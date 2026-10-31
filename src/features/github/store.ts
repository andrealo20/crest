import { useEffect } from "react";
import { createStore } from "../../lib/store";
import { rowVisible } from "../../notch/row/visibility";
import { fetchGithub, type GithubContributions } from "../../platform/services";
import { settings } from "../../settings/store";

/** Rust caches for an hour; asking more often would only return the cache. */
const POLL_MS = 3_600_000;

/** Calendar shared by the GitHub tool and the closed-row part; `error` is a code from Rust. */
export const github = createStore<{ data: GithubContributions | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: false });

const viewers = createStore(0);
let timer: ReturnType<typeof setInterval> | null = null;
let timerUser = "";
let latest = 0;

export function refreshGithub(force = false): Promise<void> {
  const call = ++latest, user = settings.get().github.user.trim();
  github.set((g) => ({ ...g, loading: true }));
  return fetchGithub(user, force).then(
    (data) => {
      if (call === latest) github.set({ data, error: null, loading: false });
    },
    (e) => {
      // Keep the last calendar on a passing error (offline); drop it when the user is wrong.
      if (call === latest) github.set((g) => ({ data: e === "not-found" || e === "no-user" ? null : g.data, error: String(e), loading: false }));
    },
  );
}

function apply() {
  const s = settings.get(), user = s.github.user.trim();
  const wanted = !!user && ((s.closed.parts.github && rowVisible.get()) || viewers.get() > 0);
  if (!wanted) {
    if (timer) clearInterval(timer);
    timer = null;
    if (!user && (github.get().data || github.get().error)) {
      latest++;
      github.set({ data: null, error: null, loading: false });
    }
    return;
  }
  if (timer && timerUser === user) return;
  if (timer) clearInterval(timer);
  const { data, loading } = github.get();
  if (!loading && (data?.user.toLowerCase() !== user.toLowerCase() || Date.now() - data.fetchedAt >= POLL_MS)) void refreshGithub();
  timer = setInterval(() => void refreshGithub(), POLL_MS);
  timerUser = user;
}

export function startGithub() {
  apply();
  settings.subscribe(apply);
  rowVisible.subscribe(apply);
  viewers.subscribe(apply);
}

/** For views that show the calendar: polling while mounted. */
export function useGithubViewer() {
  useEffect(() => {
    viewers.set((n) => n + 1);
    return () => viewers.set((n) => n - 1);
  }, []);
}
