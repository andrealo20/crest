import { test } from "node:test";
import assert from "node:assert/strict";
import { kindOf } from "./windowKind.ts";

test("each page is its window", () => {
  assert.equal(kindOf("/index.html"), "notch");
  assert.equal(kindOf("/"), "notch");
  assert.equal(kindOf("/timer.html"), "timer");
  assert.equal(kindOf("/mirror.html"), "mirror");
  assert.equal(kindOf("/settings.html"), "settings");
  assert.equal(kindOf("/taskbar.html"), "taskbar");
  // Anything else is the notch's page, as today.
  assert.equal(kindOf("/somewhere/else.html"), "notch");
});
