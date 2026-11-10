import { applyPendingRestore, type RestoreResult } from "./backup";

/*
 * A restore chosen in the settings (General, Backup) is applied here, at start, before any store reads the storage:
 * src/lib/store.ts imports this right after the demo's storage swap, ahead of every store.
 */

/** What this start did with a pending restore, for the settings to say. */
export const restoreResult: RestoreResult = (() => {
  try {
    return applyPendingRestore(localStorage);
  } catch {
    // No storage at all: nothing was pending, nothing changed.
    return null;
  }
})();
