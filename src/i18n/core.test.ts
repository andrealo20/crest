import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { backendText, LANGUAGE_NAMES, LANGUAGES, languageOf, localeFor, resolveLanguage, translate, type Dict } from "./core.ts";

test("the system language picks a supported language, English otherwise", () => {
  assert.equal(resolveLanguage("system", "it-IT"), "it");
  assert.equal(resolveLanguage("system", "es-MX"), "es");
  assert.equal(resolveLanguage("system", "fr-CA"), "fr");
  assert.equal(resolveLanguage("system", "de-AT"), "de");
  assert.equal(resolveLanguage("system", "ar-EG"), "ar");
  assert.equal(resolveLanguage("system", "zh"), "zh-CN");
  assert.equal(resolveLanguage("system", "zh-SG"), "zh-CN");
  assert.equal(resolveLanguage("system", "zh-TW"), "en", "no Traditional Chinese");
  assert.equal(resolveLanguage("system", "pt-PT"), "pt-BR");
  assert.equal(resolveLanguage("system", "nl-NL"), "en");
  assert.equal(resolveLanguage("system", ""), "en");
  assert.equal(resolveLanguage("system", undefined), "en");
  assert.equal(resolveLanguage("system", "not a tag!"), "en");
});

test("a chosen language wins over the system, an unknown one follows it", () => {
  assert.equal(resolveLanguage("ja", "it-IT"), "ja");
  assert.equal(resolveLanguage("pt-BR", "en-US"), "pt-BR");
  assert.equal(resolveLanguage("xx", "ru-RU"), "ru");
  assert.equal(resolveLanguage(undefined, "hi-IN"), "hi");
});

test("every language resolves to itself and has its own name and a dictionary file", () => {
  const files = new Set(readdirSync(new URL(".", import.meta.url)));
  for (const l of LANGUAGES) {
    assert.equal(languageOf(l), l);
    assert.ok(LANGUAGE_NAMES[l]);
    // German is the ids themselves and needs a file only for corrections.
    if (l !== "de") assert.ok(files.has(`${l}.json`), `${l}.json`);
  }
});

test("the locale keeps the system's region for the same language", () => {
  assert.equal(localeFor("es", "es-MX"), "es-MX");
  assert.equal(localeFor("es", "it-IT"), "es-ES");
  assert.equal(localeFor("en", "en-US"), "en-US");
  assert.equal(localeFor("en", "de-DE"), "en-GB");
  assert.equal(localeFor("zh-CN", "zh-TW"), "zh-CN");
  assert.equal(localeFor("ar", undefined), "ar");
  for (const l of LANGUAGES) assert.doesNotThrow(() => new Intl.NumberFormat(localeFor(l, "")));
});

test("lookup falls back to English, then to the German id", () => {
  const en: Dict = { Heute: "Today", Morgen: "Tomorrow", "vor {n} Min.": "{n} min ago" };
  const it: Dict = { Heute: "Oggi", Morgen: "" };
  assert.equal(translate("Heute", undefined, it, en), "Oggi");
  assert.equal(translate("Morgen", undefined, it, en), "Tomorrow", "an empty entry counts as missing");
  assert.equal(translate("Gestern", undefined, it, en), "Gestern");
  assert.equal(translate("vor {n} Min.", { n: 5 }, it, en), "5 min ago");
  // German: its own corrections or the id, never English.
  assert.equal(translate("Heute", undefined, {}, null), "Heute");
  assert.equal(translate("{a} {b}", { a: "{b}", b: "x" }, {}, null), "{b} x", "one pass, values are not replaced again");
  assert.equal(translate("{a} {zz}", { a: 1 }, {}, null), "1 {zz}");
});

test("Rust's German errors go through the dictionary, with their details", () => {
  const en: Dict = {
    "Kein Token": "No token received",
    "Fehler {code}: {text}": "Error {code}: {text}",
    "Schlüssel abgelehnt ({code}): {text}": "Key rejected ({code}): {text}",
    "Keine Verbindung: {text}": "No connection: {text}",
  };
  const it: Dict = { "Fehler {code}: {text}": "Errore {code}: {text}" };
  const tEn = (id: string, vars?: Record<string, string>) => translate(id, vars, en, null);
  const tIt = (id: string, vars?: Record<string, string>) => translate(id, vars, it, en);
  assert.equal(backendText("Kein Token", tEn), "No token received");
  assert.equal(backendText("Fehler 500: down\nnow", tEn), "Error 500: down\nnow");
  assert.equal(backendText("Fehler 500: down", tIt), "Errore 500: down");
  assert.equal(backendText("Schlüssel abgelehnt (401): bad key", tIt), "Key rejected (401): bad key");
  assert.equal(backendText("Keine Verbindung: dns {x}", tEn), "No connection: dns {x}");
  assert.equal(backendText("Etwas Neues", tEn), "Etwas Neues", "unknown texts stay as they are");
});

test("en.json has every Rust error text the patterns know", () => {
  const en = JSON.parse(readFileSync(new URL("./en.json", import.meta.url), "utf8")) as Dict;
  const tEn = (id: string, vars?: Record<string, string>) => translate(id, vars, en, null);
  for (const [msg, want] of [
    ["Unbekannter Anbieter: x", "Unknown provider: x"],
    ["Schlüssel abgelehnt (401): x", "Key rejected (401): x"],
    ["Nicht gefunden (404): Base-URL oder Modell prüfen. x", "Not found (404): check base URL or model. x"],
    ["Fehler 500: x", "Error 500: x"],
    ["Keine Verbindung: x", "No connection: x"],
    ["Kein Modell eingetragen", "No model set"],
    ["Von Windows ausgeschaltet. Crest im Task-Manager unter Autostart-Apps einschalten", "Turned off in Windows. Switch Crest on in Task Manager under Startup apps"],
  ]) assert.equal(backendText(msg, tEn), want);
});
