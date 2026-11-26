import { test } from "node:test";
import assert from "node:assert/strict";
import type { LauncherApp } from "../../launcher/apps.ts";
import type { BarItem, Zone } from "../model.ts";
import { appHits, toolHits, widgetHits } from "./catalog.ts";

const tr = (key: string) => key;
const EN: Record<string, string> = { Wetter: "Weather", Uhr: "Clock" };
const ctx = { tr, en: (key: string) => EN[key] ?? key };
const start = (name: string): LauncherApp => ({ id: `shell:AppsFolder\\${name}`, name, source: "start" });
const apps = [start("Notepad"), start("Visual Studio Code"), start("Visio")];

test("a few letters find an app, which says when it is already open", () => {
  const hits = appHits(apps, "vsc", (id) => id.endsWith("Visual Studio Code"), tr);
  assert.equal(hits[0]?.title, "Visual Studio Code");
  assert.deepEqual(hits[0]?.action, { do: "app", id: "shell:AppsFolder\\Visual Studio Code" });
  assert.equal(hits[0]?.subtitle, "Wechseln zu");
  assert.equal(appHits(apps, "note", () => false, tr)[0]?.subtitle, "Öffnen");
  assert.deepEqual(appHits(apps, "  ", () => false, tr), []);
});

test("the tools handed in are found by name, in the interface's language or in English", () => {
  const tools = [
    { id: "weather", label: "Wetter" },
    { id: "timer", label: "Timer" },
  ];
  assert.deepEqual(toolHits("wetter", tools, ctx).map((h) => h.action), [{ do: "tool", tool: "weather" }]);
  assert.deepEqual(toolHits("weather", tools, ctx).map((h) => h.action), [{ do: "tool", tool: "weather" }]);
  assert.deepEqual(toolHits("holiday", tools, ctx), []);
});

test("a widget offers to go on the bar, or to come off it when it is there", () => {
  const widgets = [
    { id: "weather", label: "Wetter" },
    { id: "clock", label: "Uhr" },
  ] as const;
  const zones: Record<Zone, BarItem[]> = { left: [], center: [], right: ["clock"] };
  assert.deepEqual(widgetHits("wetter", widgets, zones, ctx).map((h) => h.action), [{ do: "widget", id: "weather", add: true }]);
  assert.deepEqual(widgetHits("clock", widgets, zones, ctx).map((h) => h.action), [{ do: "widget", id: "clock", add: false }]);
  assert.deepEqual(widgetHits("xyz", widgets, zones, ctx), []);
});
