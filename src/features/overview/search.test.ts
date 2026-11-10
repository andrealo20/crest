import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSearch, searchEngineName } from "./search.ts";

test("only a known engine turns the search line on", () => {
  assert.equal(normalizeSearch("duckduckgo"), "duckduckgo");
  assert.equal(normalizeSearch("brave"), "brave");
  for (const saved of [undefined, null, "", "off", "yahoo", 3, { id: "google" }]) assert.equal(normalizeSearch(saved), "off");
  assert.equal(searchEngineName("brave"), "Brave Search");
});
