import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const LANGS = ["ar", "en", "es", "fr", "hi", "it", "ja", "pt-BR", "ru", "zh-CN"];
const read = (l: string) => JSON.parse(readFileSync(new URL(`./${l}.json`, import.meta.url), "utf8")) as Record<string, string>;

const NOTE = "In Material gibt jedes Theme seinen Akzent und die helle oder dunkle Seite vor; die Farbe änderst du unter Farben";
// The Material style's strings, with English and Italian from section 6.15 of the design.
const KEYS: [string, string, string][] = [
  ["Stil", "Style", "Stile"],
  ["Das gewohnte Aussehen", "The look you know", "L'aspetto di sempre"],
  ["Farben aus dem Theme, weiche Formen", "Colours from your theme, soft shapes", "Colori dal tema, forme morbide"],
  ["Formen, Farben, Symbole und Bewegung der ganzen App", "Shapes, colours, icons and motion across the app", "Forme, colori, icone e movimento di tutta l'app"],
  [NOTE, "In Material a theme gives its accent and its light or dark side; change the colour under Colours", "In Material ogni tema dà il suo accento e il lato chiaro o scuro; il colore si cambia in Colori"],
  ["Automatisch ({font})", "Automatic ({font})", "Automatico ({font})"],
  ["Startfarbe", "Starting colour", "Colore di partenza"],
  ["In Material zählt nur, ob er hell oder dunkel ist", "In Material only light or dark counts", "In Material conta solo se è chiaro o scuro"],
  ["Gilt für die ganze App; ändern unter Themen", "Applies to the whole app; change it under Themes", "Vale per tutta l'app; si cambia in Temi"],
];

test("every dictionary has the Material style's strings right after Theme, in the same order", () => {
  for (const l of LANGS) {
    const keys = Object.keys(read(l));
    const at = keys.indexOf("Theme");
    assert.ok(at >= 0, `${l}: no Theme`);
    assert.deepEqual(keys.slice(at + 1, at + 1 + KEYS.length), KEYS.map(([k]) => k), l);
  }
});

test("English and Italian say what the design says", () => {
  const en = read("en");
  const it = read("it");
  for (const [k, e, i] of KEYS) {
    assert.equal(en[k], e, k);
    assert.equal(it[k], i, k);
  }
});

test("every translation of Automatisch ({font}) keeps {font}", () => {
  for (const l of LANGS) assert.match(read(l)["Automatisch ({font})"] ?? "", /\{font\}/, l);
});

const INTERACTIVE: [string, string, string][] = [
  ["Bewegter Hintergrund", "Animated background", "Sfondo animato"],
  [
    "Höhenlinien in den Farben des Themes hinter dem Einstellungsfenster, die bei jedem Seitenwechsel weiterziehen",
    "Contour lines in the theme's colours behind the settings window, drifting on at every change of page",
    "Curve di livello nei colori del tema dietro la finestra delle impostazioni, che si spostano a ogni cambio di pagina",
  ],
  ["Gefühlt", "Feels like", "Percepita"],
];

test("every dictionary has the interactive Material style's strings, and English and Italian say what the design says", () => {
  for (const l of LANGS) {
    const d = read(l);
    for (const [k] of INTERACTIVE) assert.ok(typeof d[k] === "string" && d[k] !== "" && d[k] !== "TODO", `${l}: ${k}`);
  }
  const en = read("en");
  const it = read("it");
  for (const [k, e, i] of INTERACTIVE) {
    assert.equal(en[k], e, k);
    assert.equal(it[k], i, k);
  }
});
