import { useEffect, useState } from "react";
import { navigate } from "../../notch/nav";
import { filesEngine } from "../../platform/services";
import { engine, loadEngine } from "./store";
import { settings, updateSettings } from "../../settings/store";
import { Button, Group, Row } from "../../ui/controls";
import { t } from "../../i18n";
import { LicenseRows } from "./LicenseRows";

/** Settings > Tools > Files, while the tool is on: the licence, the output folder and the engine's version, with Remove. */
export function FilesSettings() {
  const on = settings.use().tools.some((x) => x.id === "files" && x.enabled);
  return on ? <FilesGroup /> : null;
}

function FilesGroup() {
  const outDir = settings.use().files.outDir;
  const status = engine.use();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => void loadEngine(), []);

  const remove = () => {
    setBusy(true);
    setNote(null);
    filesEngine
      .remove()
      .catch((e) => setNote(String(e) === "wheel" ? t("Zuerst das Pomelo-Rad ausschalten") : t("Fehlgeschlagen")))
      .finally(() => {
        setBusy(false);
        void loadEngine();
      });
  };
  const setOut = (dir: string) => updateSettings((s) => ({ files: { ...s.files, outDir: dir } }));
  const installed = !!status?.version;

  return (
    <Group title={t("Dateien")} id="settings-files">
      <LicenseRows installed={installed} buy={!!status?.buy} />
      <Row icon="folder" label={t("Ausgabeordner")} hint={outDir || t("Neben den Originalen")}>
        {outDir && <Button onClick={() => setOut("")}>{t("Zurücksetzen")}</Button>}
        <Button onClick={() => void filesEngine.pickFolder().then((dir) => dir && setOut(dir))}>{t("Ändern")}</Button>
      </Row>
      <Row icon="download_done" label={t("Programm")} hint={note ?? (installed ? t("Version {v}", { v: status.version ?? "" }) : t("Nicht heruntergeladen"))}>
        {installed ? (
          <Button disabled={busy} onClick={remove}>
            {t("Entfernen")}
          </Button>
        ) : (
          <Button onClick={() => navigate("files")}>{t("Öffnen")}</Button>
        )}
      </Row>
    </Group>
  );
}
