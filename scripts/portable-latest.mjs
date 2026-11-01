// Adds the portable zip to a release's latest.json as windows-x86_64-portable (the entry src-tauri/src/portable.rs updates from)
// and leaves everything else as it was: JSON.parse keeps pub_date as the string it was, and the result is checked before it is written.
//   node scripts/portable-latest.mjs latest.json Crest-0.3.0-Portable-x64.zip.sig https://github.com/.../Crest-0.3.0-Portable-x64.zip
import { readFileSync, writeFileSync } from "node:fs";

const [file, sigFile, url] = process.argv.slice(2);
const fail = (why) => {
  console.error(`portable-latest: ${why}`);
  process.exit(1);
};
if (!file || !sigFile || !url) fail("usage: portable-latest.mjs <latest.json> <zip.sig> <zip url>");

const text = readFileSync(file, "utf8");
const original = JSON.parse(text);
const latest = JSON.parse(text);
const signature = readFileSync(sigFile, "utf8").trim();
if (!signature) fail("empty signature");
const installers = Object.keys(original.platforms ?? {}).filter((k) => k.startsWith("windows-x86_64") && k !== "windows-x86_64-portable");
if (!installers.length) fail("latest.json has no windows-x86_64 entry");

latest.platforms["windows-x86_64-portable"] = { signature, url };
const out = `${JSON.stringify(latest, null, 2)}\n`;

const back = JSON.parse(out);
if (typeof original.pub_date === "string" && !out.includes(JSON.stringify(original.pub_date))) fail("pub_date changed");
if (back.pub_date !== original.pub_date || back.version !== original.version) fail("pub_date or version changed");
for (const k of installers) if (JSON.stringify(back.platforms[k]) !== JSON.stringify(original.platforms[k])) fail(`${k} changed`);
if (back.platforms["windows-x86_64-portable"]?.signature !== signature) fail("portable entry missing");

writeFileSync(file, out);
console.log(`portable-latest: added windows-x86_64-portable, kept ${installers.join(", ")}`);
