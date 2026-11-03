import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The modules that use hues touch localStorage or React on import, so they are read from the source.
const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8");
const HUES = [...read("hues.ts").match(/export type Hue = ([^;]+);/)![1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
const css = read("themes.css");
const block = (selector: string) => css.slice(css.indexOf(`${selector} {`)).split("}")[0];
const used = (src: string) => [...src.matchAll(/hue: (?:\w+ \? )?"(\w+)"(?: : "(\w+)")?/g)].flatMap((m) => m.slice(1).filter(Boolean));

test("every hue has a colour on dark and on light themes", () => {
  assert.ok(HUES.length > 10);
  for (const hue of HUES) {
    assert.match(block(":root"), new RegExp(`--hue-${hue}: #`), `dark ${hue}`);
    assert.match(block(':root[data-theme="light"]'), new RegExp(`--hue-${hue}: #`), `light ${hue}`);
  }
});

test("every built-in tool has a hue of the palette", () => {
  const tabs = read("../../notch/tabs.ts");
  const list = tabs.slice(tabs.indexOf("export const tabs"), tabs.indexOf("satisfies NotchTab[]"));
  const ids = [...list.matchAll(/id: "(\w+)"/g)].map((m) => m[1]);
  const hues = [...list.matchAll(/hue: "(\w+)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 20);
  assert.equal(hues.length, ids.length);
  for (const h of hues) assert.ok(HUES.includes(h), h);
});

test("settings pages and weather use hues of the palette", () => {
  const pages = used(read("../settings/SettingsView.tsx"));
  const weather = used(read("../weather/store.ts"));
  assert.ok(pages.length >= 10 && weather.length >= 8);
  for (const h of [...pages, ...weather]) assert.ok(HUES.includes(h), h);
});
