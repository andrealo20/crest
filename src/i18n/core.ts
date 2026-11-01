/*
 * The pure part of the translation (no dictionaries, no DOM), so tests can run it:
 * the languages, which one the system asks for, the Intl locale, the lookup with its
 * fallbacks and the patterns for Rust's German error texts.
 */

/** The interface languages, in the order the setting lists them. */
export const LANGUAGES = ["en", "zh-CN", "es", "hi", "ar", "fr", "pt-BR", "ru", "ja", "de", "it"] as const;
export type Language = (typeof LANGUAGES)[number];
export type LanguageSetting = "system" | Language;
export type Dict = Record<string, string>;

/** Each language in its own name, as the setting shows it. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  "zh-CN": "简体中文",
  es: "Español",
  hi: "हिन्दी",
  ar: "العربية",
  fr: "Français",
  "pt-BR": "Português (Brasil)",
  ru: "Русский",
  ja: "日本語",
  de: "Deutsch",
  it: "Italiano",
};

/** The Intl locale when the system's own locale is not one of the language's regions. */
const LOCALES: Record<Language, string> = {
  en: "en-GB",
  "zh-CN": "zh-CN",
  es: "es-ES",
  hi: "hi-IN",
  ar: "ar",
  fr: "fr-FR",
  "pt-BR": "pt-BR",
  ru: "ru-RU",
  ja: "ja-JP",
  de: "de-DE",
  it: "it-IT",
};

export const isLanguage = (v: unknown): v is Language => (LANGUAGES as readonly unknown[]).includes(v);

/** The interface language for a BCP 47 tag ("es-MX" → es, "zh-TW" → none: no Traditional Chinese), or null. */
export function languageOf(tag: string): Language | null {
  let loc: Intl.Locale;
  try {
    loc = new Intl.Locale(tag).maximize();
  } catch {
    return null;
  }
  if (loc.language === "zh") return loc.script === "Hans" ? "zh-CN" : null;
  if (loc.language === "pt") return "pt-BR";
  return isLanguage(loc.language) ? loc.language : null;
}

/** The setting as a language: "system" (or anything unknown) follows `systemTag`, English when it is not supported. */
export function resolveLanguage(setting: unknown, systemTag: string | undefined): Language {
  if (isLanguage(setting)) return setting;
  return languageOf(systemTag ?? "") ?? "en";
}

/** The Intl locale: the system's own when it is the same language (es-MX keeps Mexican formats), otherwise the language's default. */
export function localeFor(lang: Language, systemTag: string | undefined): string {
  return systemTag && languageOf(systemTag) === lang ? systemTag : LOCALES[lang];
}

/** One entry: the language's text, else the fallback's (English), else the German id. Empty entries count as missing. */
export function translate(id: string, vars: Record<string, string | number> | undefined, dict: Dict, fallback: Dict | null): string {
  const s = dict[id] || fallback?.[id] || id;
  // One pass, so a value that contains "{x}" is never replaced again.
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/**
 * Rust's error texts (AI chat, files, sign-ins) arrive in German. Fixed ones are dictionary ids
 * themselves; these carry a detail and map to an id with named placeholders.
 */
const backendPatterns: [RegExp, string][] = [
  [/^Unbekannter Anbieter: (.*)$/s, "Unbekannter Anbieter: {name}"],
  [/^Schlüssel abgelehnt \((\d+)\): (.*)$/s, "Schlüssel abgelehnt ({code}): {text}"],
  [/^Nicht gefunden \(404\): Base-URL oder Modell prüfen\. (.*)$/s, "Nicht gefunden (404): Base-URL oder Modell prüfen. {text}"],
  [/^Fehler (\d+): (.*)$/s, "Fehler {code}: {text}"],
  [/^Keine Verbindung: (.*)$/s, "Keine Verbindung: {text}"],
];

export function backendText(msg: string, t: (id: string, vars?: Record<string, string>) => string): string {
  for (const [re, id] of backendPatterns) {
    const m = re.exec(msg);
    if (!m) continue;
    const names = [...id.matchAll(/\{(\w+)\}/g)].map((x) => x[1]);
    return t(id, Object.fromEntries(names.map((n, i) => [n, m[i + 1]])));
  }
  return t(msg);
}
