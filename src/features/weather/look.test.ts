import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Checkouts on Windows have CRLF line ends.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const view = read("./WeatherView.tsx");
const material = read("./MaterialWeather.tsx");

test("the weather view picks the Material layout from the style, entering in opacity only, and keeps Crest's branch as it was", () => {
  const body = view.slice(view.indexOf("export function WeatherView()"), view.indexOf("\n}\n", view.indexOf("export function WeatherView()")));
  const decided = body.indexOf('const material = design.use() === "material"');
  assert.ok(decided > 0 && decided < body.indexOf("return ("), "decided in the body, before the return");
  const choice = body.indexOf("material ? (");
  assert.ok(choice > 0, "the data branch chooses on the style");
  const crestAt = body.indexOf(") : (", choice);
  const materialBranch = body.slice(choice, crestAt);
  const crestBranch = body.slice(crestAt);
  assert.ok(materialBranch.includes("<MaterialWeather"), materialBranch);
  assert.ok(materialBranch.includes("initial={{ opacity: 0 }} animate={{ opacity: 1, transition: content.enter }}"), materialBranch);
  assert.ok(!materialBranch.includes("filter"), materialBranch);
  assert.ok(crestBranch.includes('filter: "blur(4px)"'), crestBranch.slice(0, 200));
  for (const part of ["<Now", "<Hours", "<Week"]) assert.ok(crestBranch.includes(part), part);
  assert.match(view, /export function WeatherIcon\(\{[^}]*weight = "fill"[^}]*\}/);
  assert.ok(view.includes("weight={weight}"));
});

test("the Material weather measures its body and lays out Stellaria's dashboard in fr rows and columns", () => {
  for (const part of [
    "weatherFit(",
    "new ResizeObserver(",
    "grid-rows-[minmax(84px,1fr)_auto_minmax(56px,auto)]",
    "grid-rows-[minmax(84px,1fr)_minmax(56px,auto)]",
    "grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]",
    "grid-cols-7",
    't("Gefühlt")',
    't("Luftfeuchtigkeit")',
    't("Wind")',
    't("Heute")',
    't("Jetzt")',
    'weight="regular"',
    "text-[48px]",
    "slice(0, 12)",
    "data-more",
    "grid-cols-[repeat(auto-fit,minmax(0,1fr))]",
  ])
    assert.ok(material.includes(part), part);
  // The low and high read from the left in every language.
  assert.match(material, /<span dir="ltr"[^>]*>\{formatTemp\(d\.min\)\} \/ \{formatTemp\(d\.max\)\}<\/span>/);
  // Measured once before the first paint, then on every resize.
  const layout = material.indexOf("useLayoutEffect(");
  assert.ok(layout > 0, "useLayoutEffect");
  const rect = material.indexOf("getBoundingClientRect()", layout);
  assert.ok(rect > layout && rect < material.indexOf("new ResizeObserver(", layout), "the rect is read before the observer");
});

test("the Material weather renders again only when the fit changes, and keeps the wind's unit in a narrow tile", () => {
  const layout = material.slice(material.indexOf("useLayoutEffect("), material.indexOf("}, []);"));
  assert.equal(layout.match(/setFit\(\(prev\) => keepFit\(prev, weatherFit\(/g)?.length, 1, layout);
  assert.ok(!/setFit\(weatherFit\(/.test(material), "no setFit without keepFit");
  // At Compatto a tile is 58 px inside: "18 km/h" all at 15 px is 63, so the unit goes to the caption size beside the number.
  assert.ok(material.includes('const [speed, unit] = formatWind(c.wind).split(" ")'));
  assert.ok(material.includes('<span className="ms-0.5 text-caption font-medium text-label-2">{unit}</span>'));
});

test("the Material weather leaves Crest's skies, heat bar and hover behind", () => {
  for (const part of ["sky(", "heat(", "hover:opacity-80", ":hover", "blur(", "color-mix(", "linear(", ":dir("]) assert.ok(!material.includes(part), part);
  assert.doesNotMatch(material, /\b(bg|text|fill|stroke|ring|border)-[\w-]+\/\d/);
});

test("at the largest sizes the extra height goes to the now card, and the detail and day tiles keep their content's height", () => {
  // Every row but the now card's sizes to its content, so nothing else stretches (Stellaria's 60 px details and its forecast tiles).
  assert.equal(material.match(/grid-rows-\[minmax\(84px,1fr\)/g)?.length, 2);
  assert.ok(!/grid-rows-\[[^\]]*\d+fr[^\]]*\]/.test(material.replace(/minmax\(84px,1fr\)/g, "")), "no fr row but the now card's");
  assert.ok(material.includes('<div className="flex min-h-0 min-w-0 flex-col justify-center gap-2">'), "the side block centres place, sun and tiles");
  assert.ok(material.includes('<div className="grid min-h-0 grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-1.5">'), "the detail tiles do not stretch");
  assert.ok(material.includes("rounded-[48px] bg-fill-1 ps-4 pe-6"), "a pill at the usual sizes, never a stadium");
});
