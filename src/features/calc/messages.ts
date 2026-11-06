import { t } from "../../i18n";
import type { Vars } from "./engine";

/** The short text of an engine error (`CalcError.code`), in the app's language. Kept apart from the engine so the engine's tests need no translation. */
export function describe(code: string, v: Vars): string {
  switch (code) {
    case "long": return t("Zeile zu lang (max. {n})", v);
    case "chars": return t("Unbekanntes Zeichen {s}", v);
    case "unexpected": return t("Unerwartet: {s}", v);
    case "incomplete": return t("Zeile unvollständig");
    case "paren": return t("Klammern passen nicht");
    case "depth": return t("Zu viele Klammern ineinander");
    case "bignum": return t("Zahl zu groß");
    case "date": return t("Ungültiges Datum {s}", v);
    case "name": return t("Unbekannter Name {s}", v);
    case "needNumber": return t("Vor {s} fehlt eine Zahl", v);
    case "unit": return t("Unbekannte Einheit {s}", v);
    case "div0": return t("Division durch null");
    case "range": return t("Ergebnis nicht darstellbar");
    case "domain": return t("{f} passt hier nicht", v);
    case "argCount": return t("Falsche Anzahl Werte für {f}", v);
    case "needParen": return t("{f} braucht Klammern", v);
    case "mismatch": return t("{a} lässt sich nicht in {b} umrechnen", v);
    case "noUnit": return t("Zum Umrechnen fehlt eine Einheit");
    case "noConvert": return t("Das lässt sich nicht umrechnen");
    case "combine": return t("Diese Werte passen nicht zusammen");
    case "twoUnits": return t("Zwei Einheiten lassen sich nicht malnehmen");
    case "unitDiv": return t("Durch eine Einheit lässt sich nicht teilen");
    case "temp": return t("Temperaturen lassen sich nicht addieren");
    case "pctPos": return t("Prozent passen hier nicht");
    case "of": return t("Vor of fehlt ein Prozentwert");
    case "plain": return t("Hier passt nur eine einfache Zahl");
    case "angle": return t("Winkel mit deg oder rad angeben");
    case "noAns": return t("Noch kein Ergebnis darüber");
    case "noAbove": return t("Die Zeile darüber hat kein Ergebnis");
    case "reserved": return t("{s} ist reserviert", v);
    case "rates": return t("Wechselkurse nicht verfügbar");
    case "noRate": return t("Kein Kurs für {a} nach {b}", v);
    case "dateOp": return t("Zu einem Datum eine Zeit addieren, z. B. 3 days");
    case "span": return t("until und since brauchen ein Datum");
    case "tooMany": return t("Mehr als {n} Zeilen", v);
    default: return t("Das ließ sich nicht berechnen");
  }
}
