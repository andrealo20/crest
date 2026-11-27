import { useEffect, useState, type ReactNode } from "react";
import { filesEngine } from "../../platform/services";
import { Button, Row, TextField } from "../../ui/controls";
import { locale, t } from "../../i18n";
import { priceShown, type License, type Price } from "./model";

type Activation = { ok: boolean; state?: string; error?: string; message?: string };

const usd = (amount: string) => `US$${amount}`;

/** The price, with the usual one struck through during an offer; a screen reader hears "regular price …, now …". */
function PriceTag({ price }: { price: Price }) {
  if (!price.was) return <>{usd(price.price)}</>;
  return (
    <>
      <s>
        <span className="sr-only">{t("Normaler Preis")} </span>
        {usd(price.was)}
      </s>{" "}
      <span className="sr-only">{t("jetzt")} </span>
      {usd(price.price)}
    </>
  );
}

/** The key row's hint about the price: the engine's when it gives one, else the panel's own. */
function priceHint(price: Price | null): ReactNode {
  if (!price) return t("Einmalig 4,99 USD, gilt in jeder Version von Crest");
  if (!price.was || !price.until) return t("Einmalig {price}, gilt in jeder Version von Crest", { price: usd(price.price) });
  // The end in UTC, as the engine gives it: never a day later than the offer lasts.
  const date = new Intl.DateTimeFormat(locale(), { day: "numeric", month: "long", timeZone: "UTC" }).format(price.until);
  return (
    <>
      <PriceTag price={price} /> {t("einmalig, gilt in jeder Version von Crest")}
      <span className="block">{t("Startangebot bis {date}. Pomelo allein kostet {was}.", { date, was: usd(price.was) })}</span>
    </>
  );
}

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
 * link, which only fills the field of the panel it opens (`takesLink`): the user activates it.
 */
export function LicenseRows({ installed, refresh = 0, takesLink = false }: { installed: boolean; refresh?: number; takesLink?: boolean }) {
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
      void filesEngine.linkKey(takesLink).then((k) => {
        if (!k) return;
        setKey(k);
        setLinked(true);
        setNote(null);
      });
    take();
    return takesLink ? filesEngine.onLinkKey(take) : undefined;
  }, [takesLink]);

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
  // Read at each render: a panel left open past the offer's end drops it at the next one.
  const price = priceShown(license?.offer, Date.now());
  const type = (text: string) => {
    setKey(text);
    setLinked(false);
  };

  return (
    <>
      <Row icon="key" label={t("Lizenz")} hint={installed ? (note ?? licenseText(license)) : t("Nach dem Download des Programms")}>
        {license?.buy && !unlocked && (
          <Button onClick={() => void filesEngine.buy().catch(() => setNote(t("Fehlgeschlagen")))}>
            {!price ? (
              t("Kaufen, 4,99 USD")
            ) : price.was ? (
              <>
                {t("Kaufen")} <PriceTag price={price} />
              </>
            ) : (
              t("Kaufen, {price}", { price: usd(price.price) })
            )}
          </Button>
        )}
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
                : priceHint(price)
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
