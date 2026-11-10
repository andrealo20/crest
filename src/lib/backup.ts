/*
 * Crest's saved data as one file, and back: every `notch:` entry of the web view's storage (settings, notes, to-dos and the
 * tools' data). API keys and passwords are not in it; they stay in the system's credential store. A restore is put aside
 * and applied at the next start, before any store reads the storage (src/lib/restorePending.ts), so nothing still running
 * can write the old data back over it. Pure: the storage is passed in.
 */

/** The file layout; a newer one is refused rather than half read. */
export const BACKUP_FORMAT = 1;
const PREFIX = "notch:";
/** Outside the prefix, so a backup never holds a pending restore. */
export const PENDING_KEY = "crest-restore";

export interface Backup {
  /** Marks the file as Crest's. */
  app: "Crest";
  format: number;
  /** The Crest version that wrote it ("" when unknown). */
  version: string;
  /** When it was made, ISO 8601 ("" when unknown). */
  created: string;
  /** Storage key → its value. */
  data: Record<string, unknown>;
}

export type BackupError = "not-backup" | "newer" | "empty";

export type StorageLike = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

/** Crest's own entries, without the copies of unreadable values set aside under `.bad` (src/lib/store.ts). */
const ours = (key: string) => key.startsWith(PREFIX) && !key.endsWith(".bad");

function keys(storage: StorageLike): string[] {
  const out: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null) out.push(key);
  }
  return out;
}

export function collectBackup(storage: StorageLike, version: string, now = new Date()): Backup {
  const data: Record<string, unknown> = {};
  for (const key of keys(storage).filter(ours).sort()) {
    const raw = storage.getItem(key);
    if (raw === null) continue;
    try {
      data[key] = JSON.parse(raw);
    } catch {
      // Not JSON: no store wrote it, so it is not data a restore could give back.
    }
  }
  return { app: "Crest", format: BACKUP_FORMAT, version, created: now.toISOString(), data };
}

/** A file's text as a backup, with only Crest's own entries kept; or why it is none. */
export function readBackup(text: string): { backup: Backup } | { error: BackupError } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "not-backup" };
  }
  const b = parsed as Partial<Record<keyof Backup, unknown>> | null;
  if (!b || typeof b !== "object" || b.app !== "Crest" || typeof b.format !== "number") return { error: "not-backup" };
  if (b.format > BACKUP_FORMAT) return { error: "newer" };
  if (!b.data || typeof b.data !== "object" || Array.isArray(b.data)) return { error: "not-backup" };
  const data = Object.fromEntries(Object.entries(b.data).filter(([key]) => ours(key)));
  if (Object.keys(data).length === 0) return { error: "empty" };
  return {
    backup: {
      app: "Crest",
      format: b.format,
      version: typeof b.version === "string" ? b.version : "",
      created: typeof b.created === "string" ? b.created : "",
      data,
    },
  };
}

/** Puts `backup` aside for the next start. Throws when the storage is full, and then nothing has changed. */
export function scheduleRestore(storage: StorageLike, backup: Backup) {
  storage.setItem(PENDING_KEY, JSON.stringify(backup));
}

export type RestoreResult = { restored: Backup } | { failed: true } | null;

/**
 * At start, before any store reads the storage: replaces all of Crest's entries with a pending backup's, all or nothing.
 * `restored` when it did, `failed` when it could not (a full storage puts the old entries back), null without one.
 */
export function applyPendingRestore(storage: StorageLike): RestoreResult {
  const raw = storage.getItem(PENDING_KEY);
  if (raw === null) return null;
  // Taken out first: it frees its room, and a restore that fails must not run again on every start.
  storage.removeItem(PENDING_KEY);
  const read = readBackup(raw);
  if ("error" in read) return { failed: true };
  const before = keys(storage).filter(ours).map((key) => [key, storage.getItem(key)] as const);
  try {
    for (const [key] of before) storage.removeItem(key);
    for (const [key, value] of Object.entries(read.backup.data)) storage.setItem(key, JSON.stringify(value));
    return { restored: read.backup };
  } catch {
    for (const key of keys(storage).filter(ours)) storage.removeItem(key);
    for (const [key, value] of before) if (value !== null) storage.setItem(key, value);
    return { failed: true };
  }
}
