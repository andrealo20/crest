import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Checkouts on Windows have CRLF line ends.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const view = read("./SystemView.tsx");
const body = (start: string) => {
  const at = view.indexOf(start);
  assert.ok(at >= 0, start);
  return view.slice(at, view.indexOf("\n}\n", at));
};

test("the graph draws its path from the tested helpers, and its area and scale only when asked", () => {
  const trend = body("export function Trend(");
  assert.ok(trend.includes("trendLine("));
  const branch = trend.indexOf("if (area)");
  assert.ok(branch > 0, "an area branch");
  assert.ok(trend.indexOf("trendArea(") > 0);
  const areaBlock = trend.slice(branch, trend.lastIndexOf("return ("));
  const crestBlock = trend.slice(trend.lastIndexOf("return ("));
  // trendArea sits in the fill helper, which only the area branch calls.
  assert.match(trend.slice(0, branch), /const fill = [^\n]*\n?[^]*?trendArea\(/);
  assert.ok(!crestBlock.includes("fill("), "Crest draws no area");
  // The strokes: 2 px with the area, today's 1.5 without, never scaled by the viewBox.
  assert.ok(trend.includes('strokeWidth={area ? "2" : "1.5"}'), "stroke width");
  assert.ok(trend.includes('vectorEffect="non-scaling-stroke"'));
  assert.match(trend, /fillOpacity=\{opacity\}/);
  assert.match(areaBlock, /fill\(second, 0\.15, "\w+"\)/);
  assert.match(areaBlock, /fill\(values, 0\.2, "\w+"\)/);
  // The areas scroll with their lines: a new key every sample.
  assert.equal(trend.match(/key=\{`\$\{key\}\$\{tick\}`\}/g)?.length, 2, "lines and areas key on tick");
  assert.ok(areaBlock.includes('<motion.g style={{ scaleY, originY: 1, transformBox: "view-box" }}>'), areaBlock);
  assert.ok(!crestBlock.includes("motion.g"), "Crest's DOM keeps no group");
  assert.ok(crestBlock.includes('className="h-[22px] min-w-0 flex-1 overflow-hidden"'), crestBlock);
  assert.ok(trend.includes("useTransform(scale, (s) => s / 100)"));
  assert.ok(trend.includes("springs.value"));
  const effect = trend.slice(trend.indexOf("useEffect("));
  const out = effect.indexOf("if (!area) return");
  assert.ok(out > 0, "the effect leaves without an area");
  assert.ok(effect.indexOf("animate(scale") > out, "the spring starts only with an area");
  assert.ok(effect.indexOf("prev.current") > out, "the previous max is compared only with an area");
  assert.ok(effect.includes("jump(100)"), "reduced motion jumps");
});

test("the rows of today's hardware draw today's graph", () => {
  const row = body("function Row(");
  const calls = row.match(/<Trend\b[^>]*\/>/g) ?? [];
  assert.equal(calls.length, 1);
  for (const call of calls) assert.doesNotMatch(call, /\b(w|h|area)=/, call);
});

test("the core columns can fill their box, and keep today's classes without fill", () => {
  const cores = body("export function CoreColumns(");
  assert.ok(cores.includes("fill = false"));
  for (const part of ["h-[16px]", "w-[4px]", "flex-1", "max-w-[4px]", "gap-px", "cores.length > 16"]) assert.ok(cores.includes(part), part);
  assert.ok(cores.includes('"flex h-[16px] items-end gap-2"'));
  assert.ok(cores.includes('"w-[4px]"'));
});

test("the Material hardware can reuse the pieces of today's", () => {
  for (const part of ["export function Trend(", "export function CoreColumns(", "export function ProcessRow(", "export function ProcessCard(", "export function NetDetail(", "export const join ="]) assert.ok(view.includes(part), part);
});

test("the graph's new parts use none of the CSS the style avoids", () => {
  const trend = body("export function Trend(");
  for (const s of ["blur(", "color-mix(", "linear(", ":dir("]) assert.ok(!trend.includes(s), s);
  assert.doesNotMatch(trend, /\b(bg|text|fill|stroke|ring|border)-[\w-]+\/\d/);
});

const materialView = read("./MaterialSystem.tsx");
// The body of one function in MaterialSystem.tsx, up to the next top-level function.
const part = (name: string) => {
  const at = materialView.search(new RegExp(`\\n(export )?function ${name}\\(`));
  assert.ok(at >= 0, name);
  const end = materialView.indexOf("\n}\n", at);
  return materialView.slice(at, end < 0 ? undefined : end);
};
const glides = (src: string) => src.split("\n").filter((l) => l.includes("useGlide("));

test("the hardware view picks the Material layout after its hooks, and Crest's layout keeps its rows", () => {
  const sv = body("export function SystemView(");
  const decided = sv.indexOf('const material = design.use() === "material"');
  const empty = sv.indexOf("if (!s) return null");
  assert.ok(decided > 0 && decided < empty, "decided before the early return, so the hooks stay in order");
  const choice = sv.indexOf("if (material) return <MaterialSystemLayout");
  const crest = sv.indexOf("return (", choice);
  assert.ok(choice > empty && crest > choice, "the Material layout returns before Crest's");
  const crestBlock = sv.slice(crest);
  assert.equal(crestBlock.match(/<Row\b/g)?.length, 7, "Crest's seven rows");
  assert.ok(sv.includes(".slice(0, 5)"), "Crest's five processes");
  for (const name of ["powerDetail", "batteryDetail"]) {
    assert.match(sv, new RegExp(`const ${name} = `), name);
    assert.ok(crestBlock.includes(`detail={${name}}`), `Crest reads ${name}`);
    assert.ok(sv.slice(choice, crest).includes(`${name}={${name}}`), `Material reads ${name}`);
  }
});

test("the Material hardware measures its body and lays out Stellaria's dashboard in fr rows and columns", () => {
  const layout = materialView.indexOf("useLayoutEffect(");
  assert.ok(layout > 0, "useLayoutEffect");
  const rect = materialView.indexOf("getBoundingClientRect()", layout);
  const observer = materialView.indexOf("new ResizeObserver(", layout);
  assert.ok(rect > layout && rect < observer, "the rect is read before the observer");
  assert.ok(materialView.slice(layout, observer).includes("systemFit("), "systemFit from the layout effect");
  assert.ok(materialView.slice(observer).includes("systemFit("), "systemFit from the observer");
  for (const s of [
    "grid-cols-[minmax(0,1.93fr)_minmax(0,1fr)]",
    "minmax(100px,120fr)",
    "minmax(64px,76fr)",
    "minmax(64px,74fr)",
    "minmax(104px,126fr)",
    "minmax(80px,152fr)",
    "text-on-secondary-container",
    't("Klicken für das nächste Laufwerk")',
    "holdProcesses.set(true)",
    "holdProcesses.set(false)",
    ".slice(0, fit.rows)",
  ])
    assert.ok(materialView.includes(s), s);
});

test("the Material hardware fills its rings and gauges from 0 on opening, and the tiles glide from where they are", () => {
  const count = (name: string) => glides(part(name)).filter((l) => /, 0\)/.test(l)).length;
  assert.equal(count("GaugeCard"), 1, "CPU and GPU share one");
  assert.equal(count("MemoryCard"), 2, "use and cache");
  assert.equal(count("DriveCard"), 1);
  assert.equal(glides(materialView).filter((l) => /, 0\)/.test(l)).length, 4, "no other gauge fills from 0");
  const tiles = [part("Tiles"), ...(materialView.includes("\nfunction Tile(") ? [part("Tile")] : [])].join("\n");
  assert.ok(glides(tiles).length > 0, "the tiles glide");
  for (const l of glides(tiles)) assert.doesNotMatch(l, /, 0\)/, l);
  assert.match(materialView, /<Ring\b[^>]*size=\{40\}[^>]*sweep=\{360\}|<Ring\b[^>]*sweep=\{360\}[^>]*size=\{40\}/);
  assert.match(materialView, /<Ring\b[^>]*sweep=\{270\}/);
});

test("the Material hardware writes its readings as Crest does: a space before %, watts with one decimal under 100", () => {
  assert.ok(materialView.includes("const percent = (n: number) => `${n} %`;"));
  assert.ok(!/\$\{n\}%/.test(materialView), "no percent without its space");
  assert.equal(materialView.match(/\$\{n\} %/g)?.length, 1, "every percent through percent()");
  const tiles = part("Tiles");
  assert.ok(tiles.includes("format={percent}"), "the battery through percent()");
  // The glide rounds to whole units, so watts glide in tenths and watts() writes one decimal under 100 as Crest's row does.
  assert.ok(tiles.includes("value={pw ? pw.watts * 10 : null}"), tiles);
  assert.ok(tiles.includes("watts(n / 10)"), tiles);
  assert.match(materialView, /import \{[^}]*\bwatts\b[^}]*\} from "\.\/format"/);
  // A tile with no reading yet hands null to the glide, which starts at the first value instead of 0.
  assert.ok(part("Tile").includes("useGlide(p.value)"), part("Tile"));
});

test("the load shape follows the gliding percent and stays readable in forced colours", () => {
  for (const s of ["<LoadShape", "loadShape(", "useMotionValueEvent("]) assert.ok(materialView.includes(s), s);
  const shape = part("LoadShape");
  assert.ok(shape.includes('fill: "var(--color-secondary-container)"') || shape.includes("fill-secondary-container"), "the shape's fill");
  assert.ok(shape.includes("forced-colors:fill-[Canvas]") && shape.includes("forced-colors:stroke-[CanvasText]"), shape);
});

test("the Material network graph fills its card with its area on a rounded scale", () => {
  const net = materialView.match(/<Trend\b[^>]*\/>/g) ?? [];
  assert.equal(net.length, 1);
  for (const s of ["area", "w={424}", "h={40}", "max={niceMax("]) assert.ok(net[0].includes(s), s);
});

test("the Material hardware uses none of the CSS the style avoids", () => {
  for (const s of ["blur(", "color-mix(", "linear(", ":dir(", ":hover"]) assert.ok(!materialView.includes(s), s);
  assert.doesNotMatch(materialView, /\b(bg|text|fill|stroke|ring|border)-[\w-]+\/\d/);
});
