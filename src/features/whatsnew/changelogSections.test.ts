import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("changelog: every section a line links to is one the settings can open", () => {
  const literal = /const sectionPage: Record<string, PageId> = \{([^}]*)\}/.exec(read("../settings/SettingsView.tsx"))?.[1];
  assert.ok(literal, "sectionPage not found in SettingsView.tsx");
  const pages = Object.fromEntries([...literal.matchAll(/"?([\w-]+)"?:\s*"([\w-]+)"/g)].map((m) => [m[1], m[2]]));
  assert.equal(pages.design, "themes");
  const entries = JSON.parse(read("../../changelog.json")) as { version: string; items: { section?: string }[] }[];
  for (const e of entries)
    for (const item of e.items) if (item.section !== undefined) assert.ok(item.section in pages, `${e.version}: unknown section "${item.section}"`);
  assert.match(read("./ChangelogList.tsx"), /navigate\("settings", item\.section\)/);
});
