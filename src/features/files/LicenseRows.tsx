import { useEffect, useState } from "react";
import { filesEngine } from "../../platform/services";
import { Button, Row, TextField } from "../../ui/controls";
import { t } from "../../i18n";
import type { License } from "./model";

type Activation = { ok: boolean; state?: string; error?: string; message?: string };

/** The licence's states and the activation's errors, as text. */
function licenseText(l: License | null): string {
  if (!l) return t("Wird geladen …");
  if (l.state === "unlocked") return l.email ? t("Freigeschaltet für {email}", { email: l.email }) : t("Freigeschaltet");
  // Without a shop yet the free files still work.
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

/**
 * The licence's rows, the same under Settings > Tools > Files and in the Pomelo scope: one key and one count of free files for
 * the Files tool and the wheel, kept by the engine. `installed`: the package is there to ask; `refresh` changes ask again.
 */
export function LicenseRows({ installed, buy, refresh = 0 }: { installed: boolean; buy: boolean; refresh?: number }) {
  const [license, setLicense] = useState<License | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = () => (installed ? filesEngine.license("status").then(setLicense) : Promise.resolve(setLicense(null))).catch(() => setLicense(null));
  useEffect(() => void load(), [installed, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = (work: Promise<unknown>) => {
    setBusy(true);
    setNote(null);
    work.finally(() => {
      setBusy(false);
      void load();
    });
  };
  const canActivate = !busy && key.trim().length >= 8;
  const activate = () => {
    if (!canActivate) return;
    act(
      filesEngine
        .license<Activation>("activate", key)
        .then((a) => (a.ok ? setKey("") : setNote(activationError(a))))
        .catch((e) => setNote(activationError(String(e)))),
    );
  };
  const unlocked = license?.state === "unlocked";

  return (
    <>
      <Row icon="key" label={t("Lizenz")} hint={installed ? (note ?? licenseText(license)) : t("Nach dem Download des Programms")}>
        {buy && !unlocked && <Button onClick={() => void filesEngine.buy()}>{t("Kaufen")}</Button>}
        {installed && unlocked && (
          <Button
            disabled={busy}
            onClick={() =>
              act(
                filesEngine
                  .license<Activation | null>("deactivate")
                  .then((a) => a && !a.ok && setNote(activationError(a)))
                  .catch((e) => setNote(activationError(String(e)))),
              )
            }
          >
            {t("Deaktivieren")}
          </Button>
        )}
      </Row>
      {installed && !unlocked && (
        <Row
          icon="password"
          label={t("Schlüssel")}
          hint={license?.state === "not-configured" ? t("Schlüssel gibt es noch nicht zu kaufen") : t("Einmalig 4,99 USD, gilt in jeder Version von Crest")}
        >
          <TextField value={key} onChange={setKey} placeholder="XXXX-XXXX-…" onSubmit={activate} width="w-48" />
          <Button primary disabled={!canActivate} onClick={activate}>
            {t("Aktivieren")}
          </Button>
        </Row>
      )}
    </>
  );
}
