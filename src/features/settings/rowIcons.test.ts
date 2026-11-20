// Every settings row draws its Material Symbol in a tonal circle when the content column is wide enough (Row in controls.tsx). A row
// left without one, or a name the generated outlines lack, would show a gap or nothing at all only under Material: these tests notice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../../ui/material-paths.ts";
import { ROW_SYMBOLS } from "../../ui/materialNames.ts";

const FILES = [
  "features/settings/SettingsView.tsx",
  "features/themes/ThemeSettings.tsx",
  "features/now-playing/MusicSettings.tsx",
  "features/window/WindowSettings.tsx",
  "features/trading/TradingSettings.tsx",
  "features/calendar/CalendarSettings.tsx",
  "features/notices/NoticesSettings.tsx",
  "features/water/WaterSettings.tsx",
  "features/vault/VaultSettings.tsx",
  "features/terminal/TerminalSettings.tsx",
  "features/system/SystemSettings.tsx",
  "features/breaks/BreaksSettings.tsx",
  "features/settings/BackupSettings.tsx",
  "features/plugins/PluginSettings.tsx",
  "notch/SizeSettings.tsx",
  "notch/EdgeSettings.tsx",
  "features/usage/ForecastSettings.tsx",
  "features/timer/LookSettings.tsx",
  "features/launcher/LauncherSettings.tsx",
  "features/clipboard/ClipboardSettings.tsx",
  "features/usage/UsageSettings.tsx",
  "features/portable/PortableNote.tsx",
  "features/meeting/HideFromSharingRow.tsx",
  "features/leetcode/LeetcodeSettings.tsx",
  "features/github/GithubSettings.tsx",
];

const read = (file: string) => readFileSync(join(import.meta.dirname, "../..", file), "utf8");

/** Each `<Row` opening tag of `code`, up to the `>` that closes it outside any braces. */
function rowTags(code: string): string[] {
  return [...code.matchAll(/<Row\b/g)].map((m) => {
    let depth = 0;
    let i = m.index + 4;
    for (; i < code.length; i++) {
      const c = code[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    return code.slice(m.index, i + 1);
  });
}

test("every settings row has an icon, but the editor's name row, whose label is the field itself", () => {
  const bare: string[] = [];
  for (const file of FILES) {
    const tags = rowTags(read(file));
    assert.ok(tags.length > 0, `${file}: no <Row found`);
    for (const tag of tags) if (!/\bicon=/.test(tag) && !/label=\{<TextField/.test(tag)) bare.push(`${file}: ${tag.replace(/\s+/g, " ").slice(0, 80)}`);
  }
  assert.deepEqual(bare, []);
});

test("every literal row icon is one of ROW_SYMBOLS", () => {
  const known = new Set<string>(ROW_SYMBOLS);
  const unknown = FILES.flatMap((file) => [...read(file).matchAll(/\bicon="([^"]*)"/g)].map((m) => m[1]).filter((name) => !known.has(name)).map((name) => `${name} in ${file}`));
  assert.deepEqual(unknown, []);
});

test("every row symbol has its outline among the generated paths", () => {
  assert.deepEqual(ROW_SYMBOLS.filter((name) => !PATHS[name]), []);
});

test("ROW_SYMBOLS has no name twice and is in alphabetical order", () => {
  assert.equal(new Set(ROW_SYMBOLS).size, ROW_SYMBOLS.length);
  assert.deepEqual([...ROW_SYMBOLS], [...ROW_SYMBOLS].sort());
});
