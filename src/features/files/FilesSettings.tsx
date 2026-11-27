import { useEffect, useState } from "react";
import { navigate } from "../../notch/nav";
import { filesEngine, type EngineStatus } from "../../platform/services";
import { settings, updateSettings } from "../../settings/store";
import { Button, Group, Row, TextField } from "../../ui/controls";
import { t } from "../../i18n";
import type { License } from "./model";

type Activation = { ok: boolean; state?: string; error?: string; message?: string };

/** The licence's states and the activation's errors, as text. */
function licenseText(l: License | null): string {
  if (!l) return t("Wird geladen …");
  if (l.state === "unlocked") return l.email ? t("Freigeschaltet für {email}", { email: l.email }) : t("Freigeschaltet");
  if (l.state === "not-configured") return t("Schlüssel gibt es noch nicht zu kaufen");
  return t("Gratis: noch {n} Dateien", { n: l.left ?? 0 });
}

function activationError(a: Activation | string): string {
  const code = typeof a === "string" ? a : a.error;
  if (code === "invalid" || code === "key") return t("Dieser Schlüssel ist ungültig");
  if (code === "used-up") return t("Dieser Schlüssel ist schon auf zu vielen PCs aktiv");
  if (code === "network" || code === "timeout") return t("Keine Verbindung");
  if (code === "not-configured") return t("Schlüssel gibt es noch nicht zu kaufen");
  return (typeof a !== "string" && a.message) || t("Fehlgeschlagen");
}

/** Settings > Tools > Files: the licence, the output folder and the engine's version, with Remove. */
export function FilesSettings() {
  const outDir = settings.use().files.outDir;
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [license, setLicense] = useState<License | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = () =>
    filesEngine
      .status()
      .then((s) => {
        setStatus(s);
        if (s.version) return filesEngine.license("status").then(setLicense);
      })
      .catch(() => setLicense(null));
  useEffect(() => void refresh(), []);

  const act = (work: Promise<unknown>) => {
    setBusy(true);
    setNote(null);
    work.finally(() => {
      setBusy(false);
      void refresh();
    });
  };
  const activate = () =>
    act(
      filesEngine
        .license<Activation>("activate", key)
        .then((a) => (a.ok ? setKey("") : setNote(activationError(a))))
        .catch((e) => setNote(activationError(String(e)))),
    );
  const setOut = (dir: string) => updateSettings((s) => ({ files: { ...s.files, outDir: dir } }));
  const installed = !!status?.version;
  const unlocked = license?.state === "unlocked";

  return (
    <Group title={t("Dateien")} id="settings-files">
      <Row icon="key" label={t("Lizenz")} hint={installed ? (note ?? licenseText(license)) : t("Nach dem Download des Programms")}>
        {status?.buy && !unlocked && <Button onClick={() => void filesEngine.buy()}>{t("Kaufen")}</Button>}
        {installed && unlocked && (
          <Button disabled={busy} onClick={() => act(filesEngine.license("deactivate").catch((e) => setNote(activationError(String(e)))))}>
            {t("Deaktivieren")}
          </Button>
        )}
      </Row>
      {installed && !unlocked && (
        <Row icon="password" label={t("Schlüssel")} hint={t("Einmalig 4,99 USD, gilt in jeder Version von Crest")}>
          <TextField value={key} onChange={setKey} placeholder="XXXXXXXX-XXXX-…" onSubmit={activate} width="w-48" />
          <Button primary disabled={busy || key.trim().length < 8} onClick={activate}>
            {t("Aktivieren")}
          </Button>
        </Row>
      )}
      <Row icon="folder" label={t("Ausgabeordner")} hint={outDir || t("Neben den Originalen")}>
        {outDir && <Button onClick={() => setOut("")}>{t("Zurücksetzen")}</Button>}
        <Button onClick={() => void filesEngine.pickFolder().then((dir) => dir && setOut(dir))}>{t("Ändern")}</Button>
      </Row>
      <Row icon="download_done" label={t("Programm")} hint={installed ? t("Version {v}", { v: status.version ?? "" }) : t("Nicht heruntergeladen")}>
        {installed ? (
          <Button disabled={busy} onClick={() => act(filesEngine.remove().catch(() => setNote(t("Fehlgeschlagen"))))}>
            {t("Entfernen")}
          </Button>
        ) : (
          <Button onClick={() => navigate("files")}>{t("Öffnen")}</Button>
        )}
      </Row>
    </Group>
  );
}
