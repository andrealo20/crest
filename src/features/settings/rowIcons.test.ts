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
  "features/taskbar/TaskbarSettings.tsx",
];

const read = (file: string) => readFileSync(join(import.meta.dirname, "../..", file), "utf8");

/** Each `<Row` (or `<name`) opening tag of `code`, up to the `>` that closes it outside any braces. */
function rowTags(code: string, name = "Row"): string[] {
  return [...code.matchAll(new RegExp(`<${name}\\b`, "g"))].map((m) => {
    let depth = 0;
    let i = m.index + 1 + name.length;
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
    for (const tag of tags) {
      if (/\bicon=/.test(tag) || /label=\{<TextField/.test(tag)) continue;
      // The bar's Glass row and glass note belong to the taskbar session (contract, point 4), which picks their icons.
      if (file === "features/taskbar/TaskbarSettings.tsx" && (tag.includes('t("Glas")') || tag.includes("gelten auch für die Notch"))) continue;
      bare.push(`${file}: ${tag.replace(/\s+/g, " ").slice(0, 80)}`);
    }
  }
  assert.deepEqual(bare, []);
});

test("the taskbar's glass sliders carry the notch's icons, field by field", () => {
  const icons = (file: string) =>
    Object.fromEntries(
      rowTags(read(file), "GlassSlider")
        .map((tag) => [tag.match(/\bfield="([^"]*)"/)?.[1], tag.match(/\bicon="([^"]*)"/)?.[1]])
        .filter(([field]) => field === "glassRefraction" || field === "glassFrost" || field === "glassRim"),
    );
  const notch = icons("features/themes/ThemeSettings.tsx");
  assert.equal(Object.keys(notch).length, 3);
  assert.deepEqual(icons("features/taskbar/TaskbarSettings.tsx"), notch);
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
