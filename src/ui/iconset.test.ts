// The Material icon set (iconset.tsx). It re-exports all of Phosphor and redraws the mapped names, so a name nobody mapped or
// redrew stays Phosphor's under the Material style without any error: these tests are what notices.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LIGHT, PATHS } from "./material-paths.ts";
import { KEEP_PHOSPHOR, MATERIAL_NAMES, REGULAR } from "./materialNames.ts";

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8");

test("every name src imports from Phosphor or from iconset is mapped to Material, kept on purpose, or a type", () => {
  const src = join(import.meta.dirname, "..");
  // iconset's own components, such as MaterialSymbol, are not Phosphor names.
  const own = new Set([...read("iconset.tsx").matchAll(/^export function (\w+)/gm)].map((m) => m[1]));
  const loose: string[] = [];
  for (const file of readdirSync(src, { recursive: true, encoding: "utf8" }).filter((f) => /\.tsx?$/.test(f))) {
    const code = readFileSync(join(src, file), "utf8");
    assert.doesNotMatch(code, /import\s+\*\s+as\s+\w+\s+from\s+["'](@phosphor-icons\/react|[^"']*\/iconset)["']/, `${file}: a namespace import bundles every icon`);
    for (const [, typeOnly, names, from] of code.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
      if (from !== "@phosphor-icons/react" && !/\/iconset$/.test(from)) continue;
      for (const spec of names.split(",").map((s) => s.trim())) {
        const name = spec.split(/\s+as\s+/)[0];
        if (!spec || typeOnly || spec.startsWith("type ") || name in MATERIAL_NAMES || KEEP_PHOSPHOR.includes(name)) continue;
        if (from !== "@phosphor-icons/react" && own.has(name)) continue;
        loose.push(`${name} in ${file}`);
      }
    }
  }
  assert.deepEqual(loose, []);
});

test("no file under src but iconset.tsx imports @phosphor-icons/react, so every icon follows the style", () => {
  const src = join(import.meta.dirname, "..");
  const direct = readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.ts$/.test(f) && join(src, f) !== join(import.meta.dirname, "iconset.tsx"))
    .filter((f) => /(from|import)\s*\(?\s*["']@phosphor-icons\/react["']/.test(readFileSync(join(src, f), "utf8")));
  assert.deepEqual(direct, []);
});

test("every mapped name has its Material outline, and the ones drawn at the regular weight their weight 300 one too", () => {
  for (const [name, material] of Object.entries(MATERIAL_NAMES)) assert.ok(PATHS[material], `${name}: no path for ${material}`);
  for (const name of REGULAR) assert.ok(LIGHT[MATERIAL_NAMES[name]], `${name}: no weight 300 outline`);
});

test("material-paths.ts opens with Google's copyright and the Apache-2.0 notice that the outlines were changed", () => {
  const head = read("material-paths.ts").split("*/")[0];
  assert.match(head, /^\/\*/);
  assert.match(head, /Copyright \d{4} Google LLC/);
  assert.match(head, /Apache-2\.0/);
  assert.match(head, /modified: outlines drawn from the font/);
});

test("iconset.tsx redraws every mapped name from the Phosphor icon of that name", () => {
  const code = read("iconset.tsx");
  const drawn = new Set([...code.matchAll(/export const (\w+) = material\(Ph(\w+), "(\w+)"\);/g)].filter(([, a, b, c]) => a === b && b === c).map((m) => m[1]));
  const alias = new Map([...code.matchAll(/export const (\w+) = (\w+);/g)].map((m) => [m[1], m[2]]));
  const missing = Object.keys(MATERIAL_NAMES).filter((name) => !drawn.has(name) && !drawn.has(alias.get(name) ?? ""));
  assert.deepEqual(missing, []);
});
