import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOOL_BUTTONS } from "./model.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("every tool button has its tab's name, icon and hue, as tabs.ts writes them", () => {
  // Both read as text: toolInfo.ts imports React's icons, and tabs.ts every tool's code.
  const tab = /id: "(\w+)",(?:\s*hue: "(\w+)",)?\s*label: "([^"]+)",\s*icon: (\w+)/g;
  const tabs = new Map([...read("../../notch/tabs.ts").matchAll(tab)].map((m) => [m[1], { label: m[3], icon: m[4], hue: m[2] }]));
  const source = read("./toolInfo.ts");
  const row = /^ {2}(\w+): \{ label: "([^"]+)", icon: (\w+)(?:, hue: "(\w+)")? \},$/gm;
  const info = new Map([...source.matchAll(row)].map((m) => [m[1], { label: m[2], icon: m[3], hue: m[4] }]));
  assert.deepEqual([...info.keys()], [...TOOL_BUTTONS]);
  for (const id of TOOL_BUTTONS) assert.deepEqual(info.get(id), tabs.get(id), id);
  assert.equal(source.includes("notch/tabs"), false);
});
