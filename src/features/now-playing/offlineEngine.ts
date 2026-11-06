import { invoke } from "@tauri-apps/api/core";
import { isNative } from "../../platform/native";
import { createStore } from "../../lib/store";

/*
 * The offline translator's worker and the files it needs (src-tauri/src/translate.rs, public/translate/worker.js).
 * The worker keeps the engine and the models it loaded while songs come in, and is closed after IDLE_MS: the models
 * take a few hundred MB while loaded, and each song is translated only once (the lyrics cache keeps the answer).
 */
const IDLE_MS = 30_000;

export interface OfflineStatus {
  engine: boolean;
  /** Downloaded pairs ("ja-en") and their size in bytes. */
  pairs: [string, number][];
}

export const offlineStatus = createStore<OfflineStatus>({ engine: false, pairs: [] });

export function refreshOfflineStatus() {
  if (isNative) void invoke<OfflineStatus>("translate_status").then(offlineStatus.set, () => {});
}
refreshOfflineStatus();

export const hasPair = (s: OfflineStatus, [from, to]: [string, string]) => s.pairs.some(([p]) => p === `${from}-${to}`);

/** Downloads the pairs one after the other; the status follows. */
export async function downloadPairs(pairs: [string, string][]) {
  try {
    for (const [from, to] of pairs) if (!hasPair(offlineStatus.get(), [from, to])) await invoke("translate_download", { from, to }).finally(refreshOfflineStatus);
  } finally {
    refreshOfflineStatus();
  }
}

export async function removePair([from, to]: [string, string]) {
  closeWorker();
  await invoke("translate_remove", { from, to }).finally(refreshOfflineStatus);
}

let worker: Worker | null = null;
/** Pairs the current worker has loaded: their files are not sent again. */
let inWorker = new Set<string>();
let idle = 0;
let nextId = 0;
const waiting = new Map<number, { resolve: (lines: string[]) => void; reject: (e: Error) => void }>();

function closeWorker() {
  window.clearTimeout(idle);
  worker?.terminate();
  worker = null;
  inWorker = new Set();
  for (const w of waiting.values()) w.reject(new Error("closed"));
  waiting.clear();
}

const file = (pair: string | null, kind: string) => invoke<ArrayBuffer>("translate_file", { pair, kind });

/** The lines translated along `pairs` (one model, or two through English). */
export async function translateOffline(pairs: [string, string][], lines: string[]): Promise<string[]> {
  if (!isNative) throw new Error("app only");
  window.clearTimeout(idle);
  const fresh = !worker;
  const wasm = fresh ? await file(null, "engine") : null;
  const models = await Promise.all(
    pairs.map(async ([from, to]) => {
      const key = `${from}-${to}`;
      if (!fresh && inWorker.has(key)) return { from, to };
      const [model, lex, vocab] = await Promise.all([file(key, "model"), file(key, "lex"), file(key, "vocab")]);
      return { from, to, model, lex, vocab };
    }),
  );
  if (!worker) {
    worker = new Worker("/translate/worker.js");
    worker.onmessage = ({ data }: MessageEvent<{ id: number; lines?: string[]; error?: string }>) => {
      const w = waiting.get(data.id);
      waiting.delete(data.id);
      if (data.lines) w?.resolve(data.lines);
      else w?.reject(new Error(data.error ?? "failed"));
    };
    worker.onerror = () => closeWorker();
  }
  for (const [from, to] of pairs) inWorker.add(`${from}-${to}`);
  const id = nextId++;
  const transfer = [wasm, ...models.flatMap((m) => [m.model, m.lex, m.vocab])].filter((b): b is ArrayBuffer => b instanceof ArrayBuffer);
  const result = new Promise<string[]>((resolve, reject) => waiting.set(id, { resolve, reject }));
  worker.postMessage({ id, wasm, models, lines }, transfer);
  try {
    return await result;
  } finally {
    if (waiting.size === 0) idle = window.setTimeout(closeWorker, IDLE_MS);
  }
}
