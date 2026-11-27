import { test } from "node:test";
import assert from "node:assert/strict";
import { cascades, scopeOptions, shellLayout, showsHeaderTitle } from "./shell.ts";

test("the navigation is a list from 600 px, a rail of icons from 420 and a row on top below", () => {
  assert.equal(shellLayout(820), "list");
  assert.equal(shellLayout(600), "list");
  assert.equal(shellLayout(599), "rail");
  assert.equal(shellLayout(547), "rail");
  assert.equal(shellLayout(420), "rail");
  assert.equal(shellLayout(419), "top");
  assert.equal(shellLayout(364), "top");
});

test("the page title gives way to the scope switch below 760 px, and stays without one", () => {
  assert.equal(showsHeaderTitle(759, true), false);
  assert.equal(showsHeaderTitle(760, true), true);
  assert.equal(showsHeaderTitle(500, false), true);
});

test("the groups cascade only in Material, with full motion, out of the search and with no target", () => {
  const base = { material: true, reduced: false, searching: false, target: false };
  assert.equal(cascades(base), true);
  assert.equal(cascades({ ...base, material: false }), false);
  assert.equal(cascades({ ...base, reduced: true }), false);
  assert.equal(cascades({ ...base, searching: true }), false);
  assert.equal(cascades({ ...base, target: true }), false);
});

test("the scope switch offers the Taskbar where the bar runs and Pomelo on Windows outside the Store", () => {
  assert.deepEqual(scopeOptions(true, true), ["notch", "taskbar", "pomelo"]);
  assert.deepEqual(scopeOptions(false, true), ["notch", "pomelo"]);
  assert.deepEqual(scopeOptions(true, false), ["notch", "taskbar"]);
  // Only the notch's scope: no switch at all.
  assert.deepEqual(scopeOptions(false, false), ["notch"]);
});
