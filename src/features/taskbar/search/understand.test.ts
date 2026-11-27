import { test } from "node:test";
import assert from "node:assert/strict";
import type { LauncherApp } from "../../launcher/apps.ts";
import { SETTINGS } from "./settingsTable.ts";
import { askReady, askableTools, intentPrompt, parseIntent, type IntentCatalog } from "./understand.ts";

const catalog: IntentCatalog = {
  settings: SETTINGS,
  themes: [{ id: "dracula", name: "Dracula" }],
  widgets: ["weather", "clock"],
  tools: ["weather", "timer"],
  sections: ["themes", "taskbar-look"],
};
const apps: LauncherApp[] = [{ id: "shell:AppsFolder\\Code", name: "Visual Studio Code", source: "start" }];
const local = { apps, themes: [{ id: "dracula", name: "Dracula" }, { id: "custom-1", name: "Il mio tramonto" }] };
const parse = (reply: string) => parseIntent(reply, catalog, local);

test("the reply's JSON is read clean, in a code block or after a sentence", () => {
  const want = { do: "set", id: "height", to: 48 };
  assert.deepEqual(parse('{"do":"set","id":"height","to":48}'), want);
  assert.deepEqual(parse('```json\n{"do":"set","id":"height","to":48}\n```'), want);
  assert.deepEqual(parse('Sure! Here it is: {"do":"set","id":"height","to":"48"}'), want);
});

test("what Crest does not have, or no JSON at all, is not understood; numbers keep to their limits", () => {
  assert.equal(parse('{"do":"set","id":"cornerRadius","to":100}'), null);
  assert.equal(parse('{"do":"widget","id":"stripe","add":true}'), null);
  assert.equal(parse('{"do":"none"}'), null);
  assert.equal(parse("I am not sure what you mean."), null);
  assert.equal(parse('{"do":"set","id":"autoHide","to":"yes"}'), null);
  assert.deepEqual(parse('{"do":"set","id":"height","to":999}'), { do: "set", id: "height", to: 64 });
});

test("an app and a theme by name, a widget, a tool and a page by id", () => {
  assert.deepEqual(parse('{"do":"app","name":"visual studio code"}'), { do: "app", id: "shell:AppsFolder\\Code" });
  assert.deepEqual(parse('{"do":"set","id":"theme","to":"dracula"}'), { do: "set", id: "theme", to: "dracula" });
  assert.deepEqual(parse('{"do":"widget","id":"weather","add":true}'), { do: "widget", id: "weather", add: true });
  assert.deepEqual(parse('{"do":"tool","tool":"timer"}'), { do: "tool", tool: "timer" });
  assert.deepEqual(parse('{"do":"settings","section":"themes"}'), { do: "settings", section: "themes" });
  assert.deepEqual(parse('{"do":"nudge","id":"volume","by":-1}'), { do: "nudge", id: "volume", by: -1 });
});

test("Ask is ready with a model and a key, or a model and an address of its own", () => {
  const config = { model: "m", effort: "off" as const, baseUrl: "" };
  assert.equal(askReady("openrouter", config, true), true);
  assert.equal(askReady("openrouter", config, false), false);
  assert.equal(askReady("custom", { ...config, baseUrl: "http://localhost:11434/v1" }, false), true);
  assert.equal(askReady("openai", { ...config, model: " " }, true), false);
});

test("the prompt names the settings with their limits, the themes and where colours go", () => {
  const prompt = intentPrompt(catalog);
  for (const part of ["height", "32", "64", "Dracula", "themes", "weather", "timer", "JSON"]) assert.ok(prompt.includes(part), part);
});

test("blank values from Ask are not actions: no muted PC, no first app launched", () => {
  for (const reply of ['{"do":"set","id":"volume","to":""}', '{"do":"set","id":"height","to":"  "}', '{"do":"app","name":""}', '{"do":"app","name":"  "}']) assert.equal(parse(reply), null, reply);
});

test("only Crest's own names go to Ask: the user's themes are matched here, plugins never named", () => {
  assert.deepEqual(parse('{"do":"set","id":"theme","to":"il mio tramonto"}'), { do: "set", id: "theme", to: "custom-1" });
  assert.deepEqual(askableTools(["timer", "plugin:my-thing", "weather"]), ["timer", "weather"]);
});
