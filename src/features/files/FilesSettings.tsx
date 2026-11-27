import { useEffect, useState } from "react";
import { navigate } from "../../notch/nav";
import { filesEngine } from "../../platform/services";
import { engine, loadEngine } from "./store";
import { settings, updateSettings } from "../../settings/store";
import { Button, Group, Row } from "../../ui/controls";
import { t } from "../../i18n";
import { LicenseRows, PomeloSite } from "./LicenseRows";
import { forgetSchema, pomeloOffered } from "../pomelo/store";

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
      .then(forgetSchema)
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
      <LicenseRows installed={installed} />
      <Row icon="folder" label={t("Ausgabeordner")} hint={outDir || t("Neben den Originalen")}>
        {outDir && <Button onClick={() => setOut("")}>{t("Zurücksetzen")}</Button>}
        <Button onClick={() => void filesEngine.pickFolder().then((dir) => dir && setOut(dir))}>{t("Ändern")}</Button>
      </Row>
      {pomeloOffered && (
        <Row
          icon="touch_app"
          label={t("Pomelo-Rad")}
          hint={t("Zieh Dateien im Explorer und halte Umschalt, Strg oder Alt: Ein Rad mit den Umwandlungen und Werkzeugen von Pomelo erscheint.")}
        >
          <Button onClick={() => navigate("settings", "pomelo")}>{t("Öffnen")}</Button>
        </Row>
      )}
      <Row icon="download_done" label={t("Programm")} hint={note ?? (installed ? t("Version {v}", { v: status.version ?? "" }) : t("Nicht heruntergeladen"))}>
        <PomeloSite />
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
