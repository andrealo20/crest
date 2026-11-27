import { createStore } from "../../lib/store";
import { filesEngine, type EngineStatus } from "../../platform/services";
import { t } from "../../i18n";
import { startRun, step, type RunState } from "./model";

/*
 * The Files tool's state outside its view, as the other tools keep theirs: the panel unmounts when the notch closes, while a
 * download or a run goes on in Rust. Reopened, the view finds the progress and Cancel where they were, and a run that ended
 * meanwhile has its result.
 */

/** The engine's state, null until asked. */
export const engine = createStore<EngineStatus | null>(null);

export function loadEngine(): Promise<void> {
  return filesEngine
    .status()
    .then((s) => engine.set(s))
    .catch(() => engine.set({ version: null, available: false, size: 0, buy: false }));
}

/** The running download's bytes, null while none runs; its last error. */
export const downloading = createStore<{ done: number; total: number } | null>(null);
export const downloadFailed = createStore<string | null>(null);

/** The download's errors from Rust, as text; null for a cancel. */
function downloadError(code: string): string | null {
  if (code === "cancelled") return null;
  if (code === "unavailable" || code === "mismatch") return t("Das Programm ist noch nicht verfügbar");
  if (code === "offline") return t("Keine Verbindung");
  if (code === "checksum") return t("Der Download war beschädigt. Bitte noch einmal versuchen.");
  if (code === "disk" || code === "app-data") return t("Konnte nicht gespeichert werden");
  return t("Fehlgeschlagen");
}

export function download() {
  if (downloading.get()) return;
  downloadFailed.set(null);
  downloading.set({ done: 0, total: engine.get()?.size ?? 0 });
  filesEngine
    .download((p) => downloading.set(p))
    .then((version) => engine.set((s) => (s ? { ...s, version } : s)))
    .catch((e) => downloadFailed.set(downloadError(String(e))))
    .finally(() => downloading.set(null));
}

export const cancelDownload = () => void filesEngine.downloadCancel();

/** The files picked, the run on them (null before one) and a run's error. */
export interface Job {
  paths: string[];
  run: RunState | null;
  running: boolean;
  failed: string | null;
}

export const job = createStore<Job>({ paths: [], run: null, running: false, failed: null });

export function addPaths(more: string[]) {
  job.set((j) => (j.running ? j : { ...j, run: null, failed: null, paths: [...j.paths, ...more.filter((p) => !j.paths.includes(p))] }));
}

export const clearJob = () => job.set((j) => (j.running ? j : { paths: [], run: null, running: false, failed: null }));
export const closeRun = () => job.set((j) => (j.running ? j : { ...j, run: null }));
export const setFailed = (failed: string | null) => job.set((j) => ({ ...j, failed }));

/** A run's error from Rust, as text; null for a cancel. */
export function runError(code: string): string | null {
  if (code === "cancelled") return null;
  if (code === "broken" || code === "not-installed" || code === "timeout")
    return t("Das Programm antwortet nicht. In den Einstellungen entfernen und neu herunterladen.");
  if (code === "files") return t("Eine Datei fehlt oder passt nicht zu diesem Vorgang");
  if (code === "out") return t("Der Ausgabeordner fehlt");
  if (code === "option" || code === "args" || code === "op") return t("Eine Einstellung wird nicht angenommen");
  if (code === "password") return t("Passwort fehlt");
  if (code === "busy") return t("Es läuft schon ein Vorgang");
  return t("Fehlgeschlagen");
}

/** Runs an operation on the picked files; the engine's lines land in `job` whether or not the view is open. */
export function runJob(req: { op: string; out: string | null; options: [string, string][]; secret: string | null; lang: string }) {
  const { paths, running } = job.get();
  if (running || !paths.length) return;
  let state = startRun(paths);
  job.set((j) => ({ ...j, run: state, running: true, failed: null }));
  filesEngine
    .run({ ...req, files: paths }, (line) => {
      state = step(state, line);
      job.set((j) => ({ ...j, run: state }));
    })
    .then(
      () => job.set((j) => ({ ...j, running: false })),
      (e) =>
        job.set((j) => ({
          ...j,
          running: false,
          run: String(e) === "locked" ? { ...state, locked: true } : state,
          // The engine's own words, when it said why, are already on screen.
          failed: String(e) === "locked" || state.problem ? null : runError(String(e)),
        })),
    );
}

export const cancelJob = () => void filesEngine.cancel();
