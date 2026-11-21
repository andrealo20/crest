// The app's sources read as text: emphasis is painted with the role classes, which repeat today's colours in the Crest style and
// take the theme's Material roles under Material. The tool bar (src/features/taskbar) gets its own pass.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const src = join(import.meta.dirname, "..");
const files = readdirSync(src, { recursive: true, encoding: "utf8" })
  .map((f) => f.replaceAll("\\", "/"))
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("features/taskbar/"))
  .map((f) => ({ file: f, code: readFileSync(join(src, f), "utf8") }));

/** Every line matching `re`, as file:line, minus the ones `except` names. */
function lines(re: RegExp, except: (file: string, line: string) => boolean = () => false) {
  return files.flatMap(({ file, code }) =>
    code.split("\n").flatMap((line, i) => (re.test(line) && !except(file, line) ? [`${file}:${i + 1}`] : [])),
  );
}

/** Every string literal: a class list lives in one, a template's branches included. */
const strings = () => files.flatMap(({ file, code }) => [...code.matchAll(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g)].map((m) => ({ file, s: m[0] })));
const PRIMARY = /\bbg-primary\b(?!-)/;

test("no whole bg-label paints an emphasis, the Dock's mark aside", () => {
  // The mark under the Dock's chosen tab takes the bar's ink under the glass, which rewrites --color-label but not --color-primary.
  const dockMark = (file: string, line: string) => file === "notch/Notch.tsx" && line.includes("h-[2px] w-3");
  assert.deepEqual(lines(/bg-label(?![-\w/])/, dockMark), []);
});

test("a primary fill never carries black ink, and notch-coloured ink gives way to on-primary under Material", () => {
  assert.deepEqual(strings().filter(({ s }) => PRIMARY.test(s) && /\btext-black\b/.test(s)).map(({ file, s }) => `${file}: ${s}`), []);
  const notch = strings().filter(({ s }) => PRIMARY.test(s) && /\btext-notch\b/.test(s));
  assert.ok(notch.length >= 2);
  for (const { file, s } of notch) assert.ok(s.includes("material:text-on-primary"), `${file}: ${s}`);
});

test("chosen branches sit on the secondary container", () => {
  // The Stop button is a neutral icon button, not a chosen branch.
  const stop = (file: string, line: string) => file === "features/ask/AskView.tsx" && line.includes('aria-label={t("Stopp")}');
  assert.deepEqual(lines(/bg-fill-3 text-label(?![-a-zA-Z])/, stop), []);
  const pills = files.flatMap(({ file, code }) =>
    [...code.matchAll(/<(?:motion\.)?span\b[^>]*>/g)].filter((m) => m[0].includes("layoutId") && m[0].includes("bg-fill-3")).map((m) => `${file}: ${m[0]}`),
  );
  assert.deepEqual(pills, []);
});

test("every key cap takes Material's shape", () => {
  const caps = files.flatMap(({ file, code }) => [...code.matchAll(/<kbd\b[^>]*>/g)].map((m) => ({ file, tag: m[0] })));
  assert.ok(caps.length >= 2);
  for (const { file, tag } of caps) assert.ok(tag.includes("material:rounded-[8px]"), `${file}: ${tag}`);
});

test("the filled buttons drawn in place round their corners on press", () => {
  const buttons: [string, string][] = [
    ["features/ask/AskView.tsx", 'aria-label={t("Senden")}'],
    ["features/todos/TodosView.tsx", "onClick={save}"],
    ["notch/ClosedResize.tsx", "onClick={() => closedEdit.set(false)}"],
  ];
  for (const [file, marker] of buttons) {
    const code = files.find((f) => f.file === file)!.code;
    const at = code.indexOf(marker);
    assert.ok(at >= 0, `${file}: ${marker}`);
    // The first class list after the tag opens is the button's own: attributes come before any child.
    const cls = code.slice(code.lastIndexOf("<button", at)).match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
    assert.ok(cls, `${file}: no class list`);
    assert.match(cls[1] ?? cls[2], /\bm3-morph\b/, file);
  }
});
