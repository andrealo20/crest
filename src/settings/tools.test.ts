import { test } from "node:test";
import assert from "node:assert/strict";
import { toolOff } from "./tools.ts";

const tools = [
  { id: "overview", enabled: true },
  { id: "media", enabled: true },
  { id: "timer", enabled: true },
  { id: "notes", enabled: false },
];

test("a tool dropped on the trash is switched off in its place, so its switch brings it back there", () => {
  assert.deepEqual(toolOff(tools, "media", ["overview", "media", "timer"]), [
    { id: "overview", enabled: true },
    { id: "media", enabled: false },
    { id: "timer", enabled: true },
    { id: "notes", enabled: false },
  ]);
  // The others are the very same entries.
  assert.equal(toolOff(tools, "media", ["overview", "media", "timer"])[0], tools[0]);
});

test("the last tool on the tool bar stays on, and a tool not on it changes nothing, so nothing is written", () => {
  assert.equal(toolOff(tools, "overview", ["overview"]), tools);
  assert.equal(toolOff(tools, "media", ["overview", "timer"]), tools);
});
