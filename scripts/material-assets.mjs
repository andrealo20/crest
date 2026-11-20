// The Material style's assets, cut from npm packages and committed, so a build needs neither the packages nor this script.
// Run by hand from the repository root when a package's version changes:
//   node scripts/material-assets.mjs fonts   src/assets/fonts/google-sans-flex-latin.woff2 and google-sans-flex-latin-ext.woff2
//   node scripts/material-assets.mjs paths   src/ui/material-paths.ts, the outlines of the icons src/ui/materialNames.ts maps
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as hb from "harfbuzzjs";
import subsetFont from "subset-font";
import { decompress } from "wawoff2";
import { MATERIAL_NAMES, REGULAR } from "../src/ui/materialNames.ts";

const what = process.argv[2];

/**
 * A glyph as a path for viewBox "0 -960 960 960": y flipped (fonts draw upwards), whole units, and every point relative to the one
 * before, which costs 16 KB less brotli than absolute points (labs/tipografia-e-icone.md 6.1). HarfBuzz gives one command per segment,
 * so the points of a segment are all relative to where it starts.
 */
function svgPath(commands) {
  let d = "", x = 0, y = 0, sx = 0, sy = 0;
  const expected = [];
  for (const { type, values } of commands) {
    if (type === "Z") {
      d += "z";
      [x, y] = [sx, sy];
      expected.push("z");
      continue;
    }
    const points = [];
    for (let i = 0; i < values.length; i += 2) points.push([Math.round(values[i]), Math.round(-values[i + 1])]);
    d += type.toLowerCase() + points.map(([px, py]) => `${px - x},${py - y}`).join(" ").replace(/[ ,]-/g, "-");
    [x, y] = points.at(-1);
    if (type === "M") [sx, sy] = [x, y];
    expected.push(...points.map(String));
  }
  // Read back as an SVG renderer reads it, so a mistake here stops the run instead of drawing a broken icon in the app.
  const read = [];
  [x, y, sx, sy] = [0, 0, 0, 0];
  for (const [, cmd, args] of d.matchAll(/([mlqcz])([^mlqcz]*)/g)) {
    if (cmd === "z") {
      [x, y] = [sx, sy];
      read.push("z");
      continue;
    }
    const n = args.match(/-?\d+/g).map(Number);
    const points = [];
    for (let i = 0; i < n.length; i += 2) points.push([x + n[i], y + n[i + 1]]);
    [x, y] = points.at(-1);
    if (cmd === "m") [sx, sy] = [x, y];
    read.push(...points.map(String));
  }
  if (read.join(" ") !== expected.join(" ")) throw new Error(`svgPath() wrote a path that does not read back: ${d.slice(0, 80)}`);
  return d;
}

if (what === "fonts") {
  // Google Sans Flex drawn as Stellaria draws its full file, rounded at 25 with the optical size following the text, at a sixteenth
  // of the bytes: ROND, width, slant and grade fixed, opsz kept from 11 to 18 px (Crest's text sizes) and the weight from 200 to 700.
  // Rounding baked in means no font-variation-settings rule can lose it. OFL-1.1: this is a Modified Version.
  await mkdir("src/assets/fonts", { recursive: true });
  for (const sub of ["latin", "latin-ext"]) {
    const full = await readFile(`node_modules/@fontsource-variable/google-sans-flex/files/google-sans-flex-${sub}-full-normal.woff2`);
    const out = await subsetFont(full, null, {
      targetFormat: "woff2",
      keepAllGlyphs: true,
      variationAxes: { ROND: 25, wdth: 100, slnt: 0, GRAD: 0, opsz: { min: 11, max: 18 }, wght: { min: 200, max: 700 } },
    });
    await writeFile(`src/assets/fonts/google-sans-flex-${sub}.woff2`, out);
    console.log(`google-sans-flex-${sub}.woff2: ${out.length} bytes`);
  }
} else if (what === "paths") {
  // SVG paths rather than an icon font: a font loads late and shows a ligature's name until it does, while a path draws in the same
  // frame as its component, in every window and in the markup the mirrors receive. Rounded, opsz 24, grade 0, weight 500: the stroke
  // of Phosphor's bold, the weight Crest draws with. Weight 300, a 1 px stroke at 16 px, only for the icons drawn at regular.
  const { version } = JSON.parse(await readFile("node_modules/material-symbols/package.json", "utf8"));
  const face = new hb.Face(new hb.Blob(await decompress(await readFile("node_modules/material-symbols/material-symbols-rounded.woff2"))));
  const font = new hb.Font(face);
  // The filled glyph is a different glyph, picked through feature variations on FILL: the axes must be set before the name is
  // shaped, or both drawings come out as the outline.
  const draw = (name, FILL, wght) => {
    font.setVariations([new hb.Variation("FILL", FILL), new hb.Variation("wght", wght), new hb.Variation("GRAD", 0), new hb.Variation("opsz", 24)]);
    const buffer = new hb.Buffer();
    buffer.addText(name);
    buffer.guessSegmentProperties();
    hb.shape(font, buffer);
    const glyphs = buffer.getGlyphInfos();
    if (glyphs.length !== 1) throw new Error(`material-symbols ${version} has no "${name}": the name shapes to ${glyphs.length} glyphs, not one`);
    return svgPath(font.glyphToJson(glyphs[0].codepoint));
  };
  const names = [...new Set(Object.values(MATERIAL_NAMES))].sort();
  const regular = new Set(REGULAR.map((name) => MATERIAL_NAMES[name]));
  const paths = names.map((name) => {
    const outline = draw(name, 0, 500), fill = draw(name, 1, 500);
    return `  ${name}: [${JSON.stringify(outline)}, ${fill === outline ? 0 : JSON.stringify(fill)}],`;
  });
  const light = names.filter((name) => regular.has(name)).map((name) => `  ${name}: ${JSON.stringify(draw(name, 0, 300))},`);
  const out = `/*
 * Generated by scripts/material-assets.mjs paths: do not edit.
 * Material Symbols Rounded from material-symbols ${version}, ${face.getName(0, "en").replace(/\s+/g, " ")}
 * Licensed under the Apache License, Version 2.0 (Apache-2.0): licenses/MaterialSymbols-Apache-2.0.txt.
 * modified: outlines drawn from the font at opsz 24, grade 0, weight 500 (300 in LIGHT) and fill 0 and 1, rounded to whole units.
 */

/** Each icon's outline and filled shape for viewBox "0 -960 960 960", the filled one 0 where it draws the same as the outline. */
export const PATHS: Record<string, readonly [outline: string, fill: string | 0]> = {
${paths.join("\n")}
};

/** The outline at weight 300, for the icons Crest draws at Phosphor's regular weight (REGULAR in materialNames.ts). */
export const LIGHT: Record<string, string> = {
${light.join("\n")}
};
`;
  await writeFile("src/ui/material-paths.ts", out);
  console.log(`material-paths.ts: ${names.length} icons, ${light.length} at weight 300, ${out.length} bytes`);
} else {
  console.error("Usage: node scripts/material-assets.mjs fonts|paths");
  process.exit(1);
}
