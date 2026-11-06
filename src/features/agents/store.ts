import { useEffect } from "react";
import { createStore } from "../../lib/store";
import { windowShell } from "../../platform/services";
import { fetchAgentsText } from "./api";
import { parseAgents, trackWaits, type AgentSession, type Waits } from "./sessions";

/** The next reading starts this long after the last one ended, so two never overlap. */
const POLL_MS = 10_000;
/** With these there is nothing to read until something changes on the PC; the refresh button tries again. */
const GIVE_UP = new Set(["not-found", "too-old"]);

export type AgentsError = "not-found" | "too-old" | "invalid" | "timeout" | "too-big" | "failed";

export interface AgentsState {
  sessions: AgentSession[];
  /** Entries of the list that were no sessions or past the cap. */
  skipped: number;
  waits: Waits;
  /** Set after a failed reading. The last sessions stay (marked as old by the page) unless the CLI is missing or too old. */
  error: AgentsError | null;
  loading: boolean;
  /** When the last good reading came (ms). */
  updatedAt: number | null;
}

export const agents = createStore<AgentsState>({ sessions: [], skipped: 0, waits: new Map(), error: null, loading: false, updatedAt: null });

/** Mounted views: the tool is on screen, so the notch is open. Nothing is read otherwise. */
let viewers = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

const KNOWN = new Set<string>(["not-found", "too-old", "invalid", "timeout", "too-big", "failed"]);

async function load(): Promise<void> {
  try {
    const parsed = parseAgents(await fetchAgentsText());
    if (parsed.ok) {
      const now = Date.now();
      agents.set((s) => ({ sessions: parsed.sessions, skipped: parsed.skipped, waits: trackWaits(s.waits, parsed.sessions, now), error: null, loading: false, updatedAt: now }));
    } else fail(parsed.reason);
  } catch (e) {
    const code = String(e);
    // A reading refused because another one was still running: that one answers.
    if (code === "busy") agents.set((s) => ({ ...s, loading: false }));
    else fail(KNOWN.has(code) ? (code as AgentsError) : "failed");
  }
}

function fail(error: AgentsError) {
  const gone = GIVE_UP.has(error);
  agents.set((s) => ({ ...s, sessions: gone ? [] : s.sessions, skipped: gone ? 0 : s.skipped, waits: gone ? new Map() : s.waits, error, loading: false }));
}

/** One reading; asked again while one runs it joins that one. */
export function refreshAgents(): Promise<void> {
  if (inFlight) return inFlight;
  agents.set((s) => ({ ...s, loading: true }));
  inFlight = load().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** The window is hidden (the hide shortcut or an app rule) while the notch is still open on this tool. */
let hidden = false;

function schedule() {
  if (viewers === 0 || hidden || timer) return;
  timer = setTimeout(() => {
    timer = null;
    void poll();
  }, POLL_MS);
}

async function poll() {
  if (viewers === 0 || hidden) return;
  await refreshAgents();
  const { error } = agents.get();
  if (!error || !GIVE_UP.has(error)) schedule();
}

/** The refresh button: read now, and go on polling after a CLI that was missing has turned up. */
export function refreshAgentsNow() {
  if (timer) clearTimeout(timer);
  timer = null;
  void poll();
}

/** For the Agents view: it reads every 10 seconds while mounted (the notch is open on this tool), never otherwise. */
export function useAgentsViewer() {
  useEffect(() => {
    if (viewers++ === 0) void poll();
    const off = windowShell.onHidden((h) => {
      hidden = h;
      if (h && timer) {
        clearTimeout(timer);
        timer = null;
      } else if (!h) schedule();
    });
    return () => {
      off();
      if (--viewers === 0 && timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
  }, []);
}
