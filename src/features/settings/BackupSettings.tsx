import { useState } from "react";
import { collectBackup, readBackup, scheduleRestore, type Backup, type BackupError } from "../../lib/backup";
import { restoreResult } from "../../lib/restorePending";
import { holdOpen } from "../../notch/useNotchState";
import { isNative } from "../../platform/native";
import { backupFiles, revealFile, updater } from "../../platform/services";
import { Button, Group, Row } from "../../ui/controls";
import { locale, t } from "../../i18n";

const readErrors: Record<BackupError, string> = {
  "not-backup": "Diese Datei ist kein Backup von Crest",
  newer: "Dieses Backup stammt aus einer neueren Version von Crest; aktualisiere Crest zuerst",
  empty: "In diesem Backup sind keine Daten",
};
const fileErrors: Record<string, string> = {
  "too-big": "Die Datei ist zu groß für ein Backup",
  unreadable: "Die Datei konnte nicht gelesen werden",
  write: "Das Backup konnte nicht gespeichert werden",
  "no-folder": "Der Ordner Dokumente ist nicht erreichbar",
};
const fileError = (e: unknown) => t(fileErrors[String(e)] ?? "Das hat nicht geklappt, bitte noch einmal versuchen");

/** The backup's date in the interface language; null when the file has none. */
function when(iso: string): string | null {
  const d = new Date(iso);
  return iso && !Number.isNaN(d.getTime()) ? new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(d) : null;
}

/** Everything Crest saved right now, as the file's text. */
async function currentData(): Promise<string> {
  return JSON.stringify(collectBackup(localStorage, await updater.current()), null, 2);
}

/**
 * Settings, General: a backup of Crest's data into Documents/Crest/Backups, and a restore from one. A restore first saves the
 * data it replaces as a backup of its own, then restarts Crest, which applies it before anything reads the data (src/lib/backup.ts).
 */
export function BackupSettings() {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, setPending] = useState<Backup | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  // Files and a restart: nothing the browser demo can do.
  if (!isNative) return null;

  const save = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      setSaved(await backupFiles.save(await currentData(), false));
    } catch (e) {
      setSaved(null);
      setSaveError(fileError(e));
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    setBusy(true);
    setRestoreError(null);
    // The picker takes the pointer off the notch; it stays open meanwhile.
    holdOpen(true);
    try {
      const text = await backupFiles.open();
      if (text === null) return;
      const read = readBackup(text);
      if ("error" in read) setRestoreError(t(readErrors[read.error]));
      else setPending(read.backup);
    } catch (e) {
      setRestoreError(fileError(e));
    } finally {
      holdOpen(false);
      setBusy(false);
    }
  };

  const restore = async (backup: Backup) => {
    setBusy(true);
    try {
      // The data it replaces goes into a file first, so picking the wrong backup loses nothing.
      await backupFiles.save(await currentData(), true);
      scheduleRestore(localStorage, backup);
    } catch (e) {
      setPending(null);
      setBusy(false);
      setRestoreError(e instanceof DOMException ? t("Kein Platz, um das Backup bereitzulegen") : fileError(e));
      return;
    }
    try {
      await backupFiles.restart();
    } catch {
      // The restore waits; it happens at the next start, whenever that is.
      setPending(null);
      setBusy(false);
      setRestoreError(t("Starte Crest neu, um die Wiederherstellung abzuschließen"));
    }
  };

  const savedHint = saved ? t("Gespeichert als {name}", { name: saved.split(/[\\/]/).pop() ?? saved }) : null;
  const restored = restoreResult && "restored" in restoreResult ? when(restoreResult.restored.created) : undefined;
  const restoredHint =
    restoreResult === null
      ? null
      : "failed" in restoreResult
        ? <span className="text-orange">{t("Das Backup konnte nicht wiederhergestellt werden; die bisherigen Daten sind geblieben")}</span>
        : restored
          ? t("Wiederhergestellt aus dem Backup vom {date}", { date: restored })
          : t("Aus dem Backup wiederhergestellt");
  const pendingDate = pending && when(pending.created);

  return (
    <Group title={t("Backup")} id="settings-backup">
      <Row
        label={t("Backup erstellen")}
        hint={
          saveError ? (
            <span className="text-orange">{saveError}</span>
          ) : (
            (savedHint ?? t("Einstellungen, Notizen, To-dos und die Daten der Tools als Datei in Dokumente › Crest › Backups. Schlüssel und Passwörter sind nicht dabei"))
          )
        }
      >
        <div className="flex shrink-0 items-center gap-1.5">
          {saved && <Button onClick={() => void revealFile(saved).catch(() => {})}>{t("Im Ordner zeigen")}</Button>}
          <Button disabled={busy} onClick={() => void save()}>
            {t("Erstellen")}
          </Button>
        </div>
      </Row>
      {pending ? (
        <Row
          label={pendingDate ? t("Backup vom {date} wiederherstellen?", { date: pendingDate }) : t("Dieses Backup wiederherstellen?")}
          hint={t("Ersetzt alle Daten von Crest. Die jetzigen werden vorher als Backup gesichert, dann startet Crest neu")}
        >
          <div className="flex shrink-0 items-center gap-1.5">
            <Button disabled={busy} onClick={() => setPending(null)}>
              {t("Abbrechen")}
            </Button>
            <Button primary disabled={busy} onClick={() => void restore(pending)}>
              {t("Wiederherstellen")}
            </Button>
          </div>
        </Row>
      ) : (
        <Row
          label={t("Aus einem Backup wiederherstellen")}
          hint={restoreError ? <span className="text-orange">{restoreError}</span> : (restoredHint ?? t("Ersetzt alle Daten von Crest durch die des Backups und startet Crest neu"))}
        >
          <Button disabled={busy} onClick={() => void choose()}>
            {t("Datei wählen …")}
          </Button>
        </Row>
      )}
    </Group>
  );
}
