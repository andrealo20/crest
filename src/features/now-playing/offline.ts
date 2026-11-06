// Offline translation of lyrics, the pure part: which language a song is in, which models take it to Crest's language,
// and the answer as LRC for the lyrics cache. The engine runs in public/translate/worker.js (offlineEngine.ts).
import type { LyricLine } from "./lrc.ts";

/** Languages offered for download in Settings: the ones lyrics come in most (English itself goes straight to the target). */
export const OFFLINE_SOURCES = ["en", "ja", "ko", "zh", "es", "fr", "pt", "de", "it", "ru"] as const;

/** Languages songs can be translated into: each has a model from English. */
export const OFFLINE_TARGETS = ["en", "it", "es", "fr", "de", "pt", "ru", "ja", "ko", "zh"] as const;

/** Crest's interface language as a model code: "pt-BR" is "pt", "zh-CN" is "zh". */
export function modelCode(lang: string): string {
  return lang.split("-")[0].toLowerCase();
}

/** The language to translate into: the one picked in Settings, or Crest's own ("" or one no longer offered). */
export function targetOf(picked: string | undefined, lang: string): string {
  return picked && (OFFLINE_TARGETS as readonly string[]).includes(picked) ? picked : modelCode(lang);
}

/** The models from `from` to `to`: one when either is English, two through English otherwise, none for the same language. */
export function pairsFor(from: string, to: string): [string, string][] {
  if (from === to) return [];
  if (from === "en" || to === "en") return [[from, to]];
  return [
    [from, "en"],
    ["en", to],
  ];
}

/** Short words that are frequent in one language and rare in the others, for songs in Latin letters. */
const COMMON: Record<string, string[]> = {
  en: ["the", "and", "you", "i", "my", "me", "is", "it", "to", "of", "in", "your", "that", "with", "don't", "i'm", "on", "be", "love"],
  es: ["el", "la", "de", "que", "y", "en", "los", "las", "mi", "tu", "yo", "te", "por", "con", "no", "una", "es", "me", "amor"],
  fr: ["le", "la", "les", "de", "et", "je", "tu", "que", "pas", "est", "un", "une", "des", "dans", "pour", "mon", "moi", "toi", "c'est"],
  pt: ["o", "a", "os", "de", "e", "que", "não", "eu", "você", "do", "da", "em", "um", "uma", "meu", "minha", "com", "pra", "é"],
  de: ["der", "die", "das", "und", "ich", "du", "nicht", "ist", "ein", "eine", "mit", "mich", "dich", "zu", "wir", "auf", "es", "sie", "mein"],
  it: ["il", "la", "di", "che", "e", "non", "io", "tu", "un", "una", "per", "mi", "ti", "sono", "con", "come", "del", "della", "è"],
};

/**
 * The language of a song from its lines, or null when unclear. Scripts decide for Japanese (any kana), Korean, Chinese
 * and Russian; songs in Latin letters go to the language whose common words are most of the text. A song mostly in
 * English with a few words of another counts as English, so it is not translated.
 */
export function detectLanguage(texts: string[]): string | null {
  const all = texts.join("\n");
  const count = (re: RegExp) => all.match(re)?.length ?? 0;
  const kana = count(/[぀-ヿ]/g), hangul = count(/[가-힯]/g), han = count(/[一-鿿]/g);
  const cyrillic = count(/[Ѐ-ӿ]/g), latin = count(/[a-zA-ZÀ-ɏ]/g);
  const letters = kana + hangul + han + cyrillic + latin;
  if (letters === 0) return null;
  if (hangul / letters > 0.2) return "ko";
  if (kana / letters > 0.05) return "ja";
  if (han / letters > 0.2) return "zh";
  if (cyrillic / letters > 0.4) return "ru";
  const words = all.toLowerCase().match(/[a-zà-ÿ']+/g) ?? [];
  const scores = Object.entries(COMMON).map(([code, list]) => [code, words.filter((w) => list.includes(w)).length] as const);
  scores.sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  // Too few known words, or two languages too close to call.
  if (best[1] < 5 || best[1] < second[1] * 1.3) return null;
  return best[0];
}

const stamp = (t: number) => {
  const cs = Math.round(t * 100);
  return `${String(Math.floor(cs / 6000)).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

/** Translations by line as LRC with the lines' stamps, for the lyrics cache; null when there is none. */
export function translationLrc(lines: LyricLine[], translated: (string | null)[]): string | null {
  const out = lines.map((l, i) => (translated[i] ? `[${stamp(l.time)}]${translated[i]}\n` : "")).join("");
  return out || null;
}
