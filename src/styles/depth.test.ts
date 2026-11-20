// The sources read as text: what floats outside the controls keeps Crest's hand-written shadow and takes Material's elevation level
// under Material, with the dragged rows' state layer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CREST = "shadow-[0_6px_18px_rgb(0_0_0/0.45)]";
const src = join(import.meta.dirname, "..");

// File, level, how many class strings carry the shadow there, and whether they are dragged rows.
const sites: [string, number, number, boolean][] = [
  ["features/settings/SettingsView.tsx", 4, 2, true],
  ["features/launcher/FavoriteList.tsx", 4, 1, true],
  ["features/usage/UsageSettings.tsx", 4, 1, true],
  ["features/ports/PortsPanel.tsx", 3, 1, false],
  ["features/vault/VaultView.tsx", 3, 1, false],
  ["features/system/SystemView.tsx", 2, 1, false],
];

for (const [file, level, count, dragged] of sites)
  test(`${file}: Crest's shadow, and level ${level} under Material`, () => {
    const code = readFileSync(join(src, file), "utf8");
    const strings = [...code.matchAll(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g)].map((m) => m[0]).filter((s) => s.includes(CREST));
    assert.equal(strings.length, count);
    for (const s of strings) {
      // A dragged row's classes sit in a string inside the row's template literal, which the match takes whole.
      const classes = s.split(/[\s"'`]+/);
      assert.deepEqual(classes.filter((c) => c.startsWith("material:shadow-")), [`material:shadow-level${level}`], s);
      assert.equal(classes.includes("m3-dragged"), dragged, s);
    }
  });
