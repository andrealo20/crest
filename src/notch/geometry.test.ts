import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dockWidth, openWidth } from "./geometry.ts";

test("the tool bar at full size: 42 px per tool, 2 px between, the separator, the gear and the padding", () => {
  assert.equal(dockWidth(1), 121);
  // The 13 tools a fresh install shows on Windows.
  assert.equal(dockWidth(13), 649);
});

test("dockWidth's sizes are the Dock's own classes in Notch.tsx", () => {
  const src = readFileSync(join(import.meta.dirname, "Notch.tsx"), "utf8");
  const dock = src.slice(src.indexOf("function Dock("), src.indexOf("function DockDrop("));
  const button = src.slice(src.indexOf("function DockButton("));
  const classes = (from: string, re: RegExp) => {
    const m = re.exec(from);
    assert.ok(m, `no match for ${re}`);
    return m[1].split(/\s+/);
  };
  const root = classes(dock, /ref=\{root\} className="([^"]*)"/);
  for (const c of ["px-3", "pt-1"]) assert.ok(root.includes(c), c);
  const capsule = classes(dock, /ref=\{capsule\}[\s\S]*?className=\{`([^`]*)`\}/);
  assert.ok(capsule.includes("p-0.5"), "p-0.5");
  // No gap between the strip, the separator and the gear.
  assert.ok(!capsule.some((c) => c.startsWith("gap-")), "a gap in the capsule");
  assert.ok(classes(dock, /ref=\{strip\} className="([^"]*)"/).includes("gap-0.5"), "gap-0.5");
  assert.match(dock, /<span aria-hidden className="mx-1 h-5 w-px /);
  assert.ok(classes(button, /className=\{`([^`]*)`\}/).includes("w-[42px]"), "w-[42px]");
});

test("a tool narrower than the tool bar opens as wide as the bar, so its icons stay in place from tool to tool (#82)", () => {
  assert.equal(openWidth(520, 13, 1920), 649);
  assert.equal(openWidth(600, 13, 1920), openWidth(520, 13, 1920));
  // A wider tool keeps its own width.
  assert.equal(openWidth(720, 13, 1920), 720);
  assert.equal(openWidth(649, 13, 1920), 649);
});

test("with more tools than the widest panel holds at full size, every tool opens at the widest panel and the buttons narrow there (#82)", () => {
  // 16 tools ask for 781 px, more than the widest panel (740).
  assert.equal(openWidth(520, 16, 1920), 740);
  assert.equal(openWidth(720, 16, 1920), 740);
});

test("where the monitor cannot hold the bar, the tool keeps its own width and the bar narrows as before", () => {
  // A 1280 px monitor at 200 % is 640 px wide.
  assert.equal(openWidth(520, 13, 640), 520);
  // A monitor narrower than the widest panel, with more tools than it holds.
  assert.equal(openWidth(520, 16, 700), 520);
  // Just as wide as the room still fits.
  assert.equal(openWidth(520, 13, 649), 649);
  assert.equal(openWidth(520, 13, Number.NaN), 520);
});
