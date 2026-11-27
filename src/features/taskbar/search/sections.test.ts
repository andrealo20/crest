import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("every Settings section the search asks for is one the Settings window can open", () => {
  // The window opens a section through SettingsView's sectionPage: an id it does not know leaves it on the page it showed last.
  const literal = /const sectionPage: Record<string, PageId> = \{([^}]*)\}/.exec(read("../../settings/SettingsView.tsx"))?.[1];
  assert.ok(literal, "sectionPage not found in SettingsView.tsx");
  const known = new Set([...literal.matchAll(/"?([\w-]+)"?:\s*"[\w-]+"/g)].map((m) => m[1]));
  const capisci = /const SECTIONS = \[([^\]]*)\]/.exec(read("./askIntent.ts"))?.[1];
  assert.ok(capisci, "SECTIONS not found in askIntent.ts");
  const asked = [
    ...[...capisci.matchAll(/"([\w-]+)"/g)].map((m) => m[1]),
    ...["./model.ts", "./settingsTable.ts", "../window/SearchPanel.tsx"].flatMap((f) => [...read(f).matchAll(/section: "([\w-]+)"/g)].map((m) => m[1])),
  ];
  assert.ok(asked.length > 10, "the sections were not found");
  assert.deepEqual(asked.filter((s) => !known.has(s)), []);
});
