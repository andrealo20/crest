import { test } from "node:test";
import assert from "node:assert/strict";
import { barEngine, normalizeSearch, searchEngineName, searchTarget } from "./search.ts";

test("only a known engine turns the search line on", () => {
  assert.equal(normalizeSearch("duckduckgo"), "duckduckgo");
  assert.equal(normalizeSearch("brave"), "brave");
  for (const saved of [undefined, null, "", "off", "yahoo", 3, { id: "google" }]) assert.equal(normalizeSearch(saved), "off");
  assert.equal(searchEngineName("brave"), "Brave Search");
});

test("the bar's search box opens a drive's or a network share's path and searches the web with anything else", () => {
  assert.equal(searchTarget(""), null);
  assert.equal(searchTarget("   "), null);
  assert.deepEqual(searchTarget(String.raw`C:\Users\Andrea\Documents`), { kind: "path", path: String.raw`C:\Users\Andrea\Documents` });
  assert.deepEqual(searchTarget(String.raw` "D:\Program Files\Crest" `), { kind: "path", path: String.raw`D:\Program Files\Crest` });
  assert.deepEqual(searchTarget("e:"), { kind: "path", path: "e:\\" });
  assert.deepEqual(searchTarget("C:/Users/Andrea"), { kind: "path", path: String.raw`C:\Users\Andrea` });
  assert.deepEqual(searchTarget(String.raw`\\nas\photos\2026`), { kind: "path", path: String.raw`\\nas\photos\2026` });
  // One backslash is the current drive's root, which depends on Crest's own folder: the web.
  assert.deepEqual(searchTarget(String.raw`\Windows`), { kind: "web", query: String.raw`\Windows` });
  assert.deepEqual(searchTarget(" rust tauri "), { kind: "web", query: "rust tauri" });
  // A quoted phrase searches as it is typed, quotes and all.
  assert.deepEqual(searchTarget('"liquid glass"'), { kind: "web", query: '"liquid glass"' });
  for (const text of ["https://github.com/andrealo20", String.raw`%USERPROFILE%\Documents`, "c:something"]) assert.deepEqual(searchTarget(text), { kind: "web", query: text });
});

test("the search box searches with Overview's engine, Bing while Overview's line is off", () => {
  assert.equal(barEngine("off"), "bing");
  assert.equal(barEngine("duckduckgo"), "duckduckgo");
});
