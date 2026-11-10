import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPendingRestore, collectBackup, PENDING_KEY, readBackup, scheduleRestore, type StorageLike } from "./backup.ts";

/** An in-memory storage; `full` says which writes a full localStorage would refuse. */
function memory(entries: Record<string, string> = {}, full: (key: string, value: string) => boolean = () => false): StorageLike & { dump(): Record<string, string> } {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem(k: string, v: string) {
      if (full(k, v)) throw new DOMException("full", "QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

const now = new Date("2026-11-10T14:05:01Z");

test("a backup holds Crest's own entries, parsed, and nothing else", () => {
  const storage = memory({
    "notch:settings": '{"lang":"it"}',
    "notch:note": '"Buy milk"',
    "notch:settings.bad": "{broken",
    "notch:weird": "not json",
    "other-app": "1",
    [PENDING_KEY]: "{}",
  });
  assert.deepEqual(collectBackup(storage, "1.1.0", now), {
    app: "Crest",
    format: 1,
    version: "1.1.0",
    created: "2026-11-10T14:05:01.000Z",
    data: { "notch:note": "Buy milk", "notch:settings": { lang: "it" } },
  });
});

test("reading a file: only a Crest backup of a known format with something in it", () => {
  const backup = collectBackup(memory({ "notch:note": '"x"' }), "1.1.0", now);
  assert.deepEqual(readBackup(JSON.stringify(backup)), { backup });
  assert.deepEqual(readBackup("not json"), { error: "not-backup" });
  assert.deepEqual(readBackup("null"), { error: "not-backup" });
  assert.deepEqual(readBackup(JSON.stringify({ ...backup, app: "Other" })), { error: "not-backup" });
  assert.deepEqual(readBackup(JSON.stringify({ ...backup, data: [] })), { error: "not-backup" });
  assert.deepEqual(readBackup(JSON.stringify({ ...backup, format: 2 })), { error: "newer" });
  // Keys that are not Crest's are dropped; with none left there is nothing to restore.
  assert.deepEqual(readBackup(JSON.stringify({ ...backup, data: { "other-app": 1, "notch:x.bad": "y" } })), { error: "empty" });
  const read = readBackup(JSON.stringify({ ...backup, version: 3, data: { "notch:note": "x", evil: 1 } }));
  assert.deepEqual(read, { backup: { ...backup, version: "", data: { "notch:note": "x" } } });
});

test("a pending restore replaces all of Crest's entries at the next start, once", () => {
  const storage = memory({ "notch:settings": '{"lang":"de"}', "notch:todo-projects": '{"tasks":[]}', "notch:settings.bad": "{x", "other-app": "1" });
  const backup = collectBackup(memory({ "notch:settings": '{"lang":"it"}', "notch:note": '"From the backup"' }), "1.1.0", now);
  scheduleRestore(storage, backup);
  assert.deepEqual(applyPendingRestore(storage), { restored: backup });
  // Entries the backup lacks are gone; set-aside copies and other apps' entries stay.
  assert.deepEqual(storage.dump(), {
    "notch:settings.bad": "{x",
    "other-app": "1",
    "notch:settings": '{"lang":"it"}',
    "notch:note": '"From the backup"',
  });
  assert.equal(applyPendingRestore(storage), null);
});

test("a restore that does not fit leaves the old data, and does not try again", () => {
  const old = { "notch:settings": '{"lang":"de"}', "notch:note": '"Old note"' };
  const backup = collectBackup(memory({ "notch:settings": '{"lang":"it"}', "notch:note": '"New note"' }), "1.1.0", now);
  // The second restored entry finds the storage full.
  const storage = memory(old, (key, value) => key === "notch:note" && value === '"New note"');
  scheduleRestore(storage, backup);
  assert.deepEqual(applyPendingRestore(storage), { failed: true });
  assert.deepEqual(storage.dump(), old);
  assert.equal(applyPendingRestore(storage), null);
  // A broken pending entry is dropped too, and nothing else changes.
  storage.setItem(PENDING_KEY, "{");
  assert.deepEqual(applyPendingRestore(storage), { failed: true });
  assert.deepEqual(storage.dump(), old);
});

test("scheduling into a full storage throws and changes nothing", () => {
  const storage = memory({ "notch:note": '"Old"' }, (key) => key === PENDING_KEY);
  const backup = collectBackup(memory({ "notch:note": '"New"' }), "1.1.0", now);
  assert.throws(() => scheduleRestore(storage, backup));
  assert.deepEqual(storage.dump(), { "notch:note": '"Old"' });
});
