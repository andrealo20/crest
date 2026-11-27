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
  // Before keys are sold the free files still work.
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
 * Buying is on Stripe, from the page the engine names; the key comes from Pomelo's service, by hand or by a `crest://license`
 * link, which only fills the field: the user activates it.
 */
export function LicenseRows({ installed, refresh = 0 }: { installed: boolean; refresh?: number }) {
  const [license, setLicense] = useState<License | null>(null);
  const [key, setKey] = useState("");
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = () => (installed ? filesEngine.license("status").then(setLicense) : Promise.resolve(setLicense(null))).catch(() => setLicense(null));
  useEffect(() => void load(), [installed, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  // A link's key, when the panel opens and while it stays open. Kept without the package, for once its download is done.
  useEffect(() => {
    const take = () =>
      void filesEngine.linkKey().then((k) => {
        if (!k) return;
        setKey(k);
        setLinked(true);
        setNote(null);
      });
    take();
    return filesEngine.onLinkKey(take);
  }, []);

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
        .then((a) => {
          if (!a.ok) return setNote(activationError(a));
          setKey("");
          setLinked(false);
        })
        .catch((e) => setNote(activationError(String(e)))),
    );
  };
  const unlocked = license?.state === "unlocked";
  const type = (text: string) => {
    setKey(text);
    setLinked(false);
  };

  return (
    <>
      <Row icon="key" label={t("Lizenz")} hint={installed ? (note ?? licenseText(license)) : t("Nach dem Download des Programms")}>
        {license?.buy && !unlocked && <Button onClick={() => void filesEngine.buy().catch(() => setNote(t("Fehlgeschlagen")))}>{t("Kaufen, 4,99 USD")}</Button>}
        {installed && license && !unlocked && <Button onClick={() => void filesEngine.recover().catch(() => setNote(t("Fehlgeschlagen")))}>{t("Schon gekauft?")}</Button>}
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
          hint={
            linked
              ? t("Schlüssel aus dem Link: Prüfe ihn und klicke auf Aktivieren")
              : license?.state === "not-configured"
                ? t("Schlüssel gibt es noch nicht zu kaufen")
                : t("Einmalig 4,99 USD, gilt in jeder Version von Crest")
          }
        >
          <TextField value={key} onChange={type} placeholder="XXXXX-XXXXX-…" onSubmit={activate} width="w-48" />
          <Button primary disabled={!canActivate} onClick={activate}>
            {t("Aktivieren")}
          </Button>
        </Row>
      )}
    </>
  );
}
