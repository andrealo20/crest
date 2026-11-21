import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { arrowStep } from "./radioKeys.ts";

test("arrows step through a radio group, mirrored right to left only on the horizontal ones", () => {
  assert.equal(arrowStep("ArrowRight", false), 1);
  assert.equal(arrowStep("ArrowRight", true), -1);
  assert.equal(arrowStep("ArrowLeft", false), -1);
  assert.equal(arrowStep("ArrowLeft", true), 1);
  assert.equal(arrowStep("ArrowDown", true), 1);
  assert.equal(arrowStep("ArrowUp", false), -1);
  assert.equal(arrowStep("Enter", false), 0);
});

test("the controls read the direction without :dir(), which macOS 12's WebKit does not know", () => {
  const source = readFileSync(new URL("./controls.tsx", import.meta.url), "utf8");
  assert.ok(!source.includes(":dir("));
});

test("every segmented control names its radio group", () => {
  const src = new URL("../", import.meta.url);
  const unnamed: string[] = [];
  for (const entry of readdirSync(src, { recursive: true }) as string[]) {
    const file = entry.replaceAll("\\", "/");
    // shortcut: the taskbar's files are phase 3 of the Material style, which names their two groups.
    if (!file.endsWith(".tsx") || file.startsWith("features/taskbar/")) continue;
    const source = readFileSync(new URL(file, src), "utf8");
    // The timer's own row of mode buttons shares the name but is not this radio group.
    if (/\bfunction Segmented\b/.test(source)) continue;
    for (const m of source.matchAll(/<Segmented(<[^>]*>)?/g)) {
      // The opening tag's own props, outside the braces of their values (an option's `label:` does not count).
      let depth = 0, named = false, i = m.index + m[0].length;
      for (; i < source.length && !(depth === 0 && source[i] === ">"); i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") depth--;
        else if (depth === 0 && /\slabel=$/.test(source.slice(i - 6, i + 1))) named = true;
      }
      if (!named) unnamed.push(`${file}:${source.slice(0, m.index).split("\n").length}`);
    }
  }
  assert.deepEqual(unnamed, []);
});
