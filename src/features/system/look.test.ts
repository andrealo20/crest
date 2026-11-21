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
