import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { arcPath } from "./ring.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("a full ring starts at the top and closes in two half arcs", () => {
  assert.equal(arcPath(40, 4, 360), "M20,2A18,18 0 1 1 20,38A18,18 0 1 1 20,2");
});

test("a 270 degree ring starts at 135 degrees and stays open at the bottom", () => {
  assert.equal(arcPath(76, 8, 270), "M13.96,62.04A34,34 0 1 1 62.04,62.04");
});

test("a gliding value springs on Material's value preset, jumps under reduced motion and never renders React to change", () => {
  const src = read("./Glide.tsx");
  for (const s of ["useSpring(reduced ? value : from, springs.value)", "jump(", "useTransform(", "Math.round"]) assert.ok(src.includes(s), s);
  assert.match(src, /reduced \?[^;]*jump\(/);
  assert.ok(!src.includes("useState"));
});

test("a ring's arcs follow their percentage, hide under half a percent and keep to the system colours", () => {
  const src = read("./Ring.tsx");
  assert.match(src, /pathLength = useTransform\([^)]*\)\s*=>\s*p \/ 100\)/);
  assert.match(src, /pathOffset = useTransform\([^)]*\)\s*=>\s*p \/ 100\)/);
  assert.match(src, /p < 0\.5 \? 0 : 1/);
  for (const s of ['strokeLinecap="round"', "forced-colors:stroke-[GrayText]", "forced-colors:stroke-[Highlight]", "var(--color-fill-2)"]) assert.ok(src.includes(s), s);
});

test("neither the glide nor the ring uses what the style rules out", () => {
  for (const file of ["./Glide.tsx", "./Ring.tsx"]) {
    const src = read(file);
    for (const s of ["blur(", "color-mix(", "linear(", ":dir("]) assert.ok(!src.includes(s), `${file}: ${s}`);
    assert.doesNotMatch(src, /\b(bg|text|fill|stroke|ring|border)-[\w-]+\/\d/, file);
  }
});
