// The Material style's assets, cut from npm packages and committed, so a build needs neither the packages nor this script.
// Run by hand from the repository root when a package's version changes:
//   node scripts/material-assets.mjs fonts   src/assets/fonts/google-sans-flex-latin.woff2 and google-sans-flex-latin-ext.woff2
import { mkdir, readFile, writeFile } from "node:fs/promises";
import subsetFont from "subset-font";

const what = process.argv[2];

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
} else {
  console.error("Usage: node scripts/material-assets.mjs fonts");
  process.exit(1);
}
