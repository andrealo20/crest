import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP_LIMIT, arrange, firstSelected, keepSelected, settingsSearchHit, understandHit, webOrPathHit, type Hit, type HitKind } from "./model.ts";

const tr = (key: string, values?: Record<string, string | number>) => key.replace(/\{(\w+)\}/g, (_, k: string) => String(values?.[k] ?? ""));
const hit = (kind: HitKind, key: string): Hit => ({ key, kind, title: key, icon: { glyph: "web" }, action: { do: "web", query: key } });

test("rows come in group order whatever order they arrive in, each group cut to its limit", () => {
  const hits = [hit("web", "w"), hit("file", "f1"), hit("answer", "a"), hit("app", "p1"), hit("understand", "u"), hit("app", "p2"), hit("settings", "s"), hit("setting", "g"), hit("widget", "d"), hit("tool", "t")];
  assert.deepEqual(arrange(hits).map((h) => h.key), ["a", "p1", "p2", "t", "g", "d", "f1", "u", "s", "w"]);
  const apps = Array.from({ length: 9 }, (_, i) => hit("app", `p${i}`));
  assert.deepEqual(arrange(apps).map((h) => h.key), ["p0", "p1", "p2", "p3", "p4"]);
  assert.equal(GROUP_LIMIT.app, 5);
  assert.equal(GROUP_LIMIT.answer, 1);
});

test("the first row starts selected unless it is Capisci, which waits to be chosen", () => {
  assert.equal(firstSelected([hit("understand", "u"), hit("web", "w")]), 1);
  // Without results Enter does what the box did before: open the path or search the web, not the Settings.
  assert.equal(firstSelected([hit("settings", "s"), hit("web", "w")]), 1);
  assert.equal(firstSelected([hit("understand", "u"), hit("settings", "s"), hit("web", "w")]), 2);
  assert.equal(firstSelected([hit("app", "p"), hit("web", "w")]), 0);
  assert.equal(firstSelected([hit("understand", "u")]), -1);
  assert.equal(firstSelected([]), -1);
});

test("a typed path opens, other text searches the web, nothing typed gives no row", () => {
  assert.deepEqual(webOrPathHit("C:\\Users", "bing", tr)?.action, { do: "path", path: "C:\\Users" });
  assert.deepEqual(webOrPathHit("hello", "bing", tr)?.action, { do: "web", query: "hello" });
  assert.equal(webOrPathHit("  ", "bing", tr), null);
});

test("the Settings row carries the text, and Capisci the sentence", () => {
  assert.deepEqual(settingsSearchHit("dock", tr).action, { do: "settings", section: null, query: "dock" });
  assert.deepEqual(understandHit("make it pink", tr).action, { do: "understand", text: "make it pink" });
});

test("a weak row, a guess from part of a name, never starts selected; a row picked with the arrows stays picked as rows arrive", () => {
  const weak: Hit = { ...hit("setting", "g"), weak: true };
  assert.equal(firstSelected([weak, hit("file", "f"), hit("web", "w")]), 1);
  const list = [hit("app", "p"), hit("file", "f1"), hit("web", "w")];
  assert.equal(keepSelected("f1", list), 1);
  assert.equal(keepSelected("gone", list), 0);
  assert.equal(keepSelected(null, list), 0);
});
