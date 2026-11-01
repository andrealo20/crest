import { en } from "./en";

/*
 * Translation: the interface is English only. The German text lives directly in the
 * code as an internal id; `en.json` provides the English text shown to everyone.
 * Missing entries fall back to the id.
 * Placeholders: t("vor {n} Min.", { n: 5 }).
 */
export type Language = "de" | "en";

/** Always English; the saved `language` setting is kept only for compatibility. */
export function lang(): Language {
  return "en";
}

export function t(de: string, vars?: Record<string, string | number>): string {
  let s = en[de] ?? de;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Locale for Intl (numbers, dates, weekdays). */
export function locale(): string {
  return "en-GB";
}

/** Error texts from Rust (AI chat, files, sign-ins) arrive in German; translate them by pattern. */
const backendPatterns: [RegExp, string][] = [
  [/^Kein Modell eingetragen$/, "No model set"],
  [/^Base-URL muss mit https:\/\/ beginnen$/, "Base URL must start with https://"],
  [/^Unbekannter Anbieter: (.*)$/, "Unknown provider: $1"],
  [/^Schlüssel abgelehnt \((\d+)\): (.*)$/s, "Key rejected ($1): $2"],
  [/^Nicht gefunden \(404\): Base-URL oder Modell prüfen\. (.*)$/s, "Not found (404): check base URL or model. $1"],
  [/^Limit erreicht \(429\), kurz warten$/, "Rate limit reached (429), wait a moment"],
  [/^Fehler (\d+): (.*)$/s, "Error $1: $2"],
  [/^Datei nicht mehr vorhanden$/, "File no longer exists"],
  [/^Dateien nicht mehr vorhanden$/, "Files no longer exist"],
  [/^Client-Secret fehlt$/, "Client secret missing"],
  [/^Keine Verbindung$/, "No connection"],
  [/^Keine Verbindung: (.*)$/s, "No connection: $1"],
  [/^Kein Token$/, "No token received"],
  [/^Kein Code$/, "No code received"],
  [/^Token abgelehnt$/, "Token rejected"],
  [/^Abgelehnt$/, "Declined"],
  [/^Im Portal http:\/\/localhost als Redirect eintragen$/, "Add http://localhost as a redirect in the developer portal"],
  [/^Von Windows ausgeschaltet\. Crest im Task-Manager unter Autostart-Apps einschalten$/, "Turned off in Windows. Switch Crest on in Task Manager under Startup apps"],
];

export function tBackend(msg: string): string {
  for (const [re, en] of backendPatterns) if (re.test(msg)) return msg.replace(re, en);
  return msg;
}
