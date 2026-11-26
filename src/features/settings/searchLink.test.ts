import { test } from "node:test";
import assert from "node:assert/strict";
import { searchSection, sectionQuery } from "./searchLink.ts";

test("the bar's search opens the Settings window on its own search, through the section it asks for", () => {
  assert.equal(searchSection("dock size"), "search:dock size");
  assert.equal(sectionQuery(searchSection("dock size")), "dock size");
  assert.equal(sectionQuery("taskbar"), null);
  assert.equal(sectionQuery("search:"), null);
});
