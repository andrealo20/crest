import { test } from "node:test";
import assert from "node:assert/strict";
import { navRoute } from "./navRoute.ts";

test("settings open in their window, natively", () => {
  assert.equal(navRoute("settings", "notch", true), "settings-window");
  assert.equal(navRoute("settings", "settings", true), "settings-window");
  assert.equal(navRoute("settings", "taskbar", true), "settings-window");
});

test("the demo keeps settings in the panel", () => {
  assert.equal(navRoute("settings", "notch", false), "panel");
});

test("a tool asked for from another window opens in the notch", () => {
  assert.equal(navRoute("launcher", "settings", true), "notch");
  assert.equal(navRoute("setup", "settings", true), "notch");
  assert.equal(navRoute("launcher", "taskbar", true), "notch");
});

test("inside the notch a tool stays in the panel", () => {
  assert.equal(navRoute("media", "notch", true), "panel");
});
