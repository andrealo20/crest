import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GLASS_GLSL } from "../../../notch/glass/shader.ts";
import { MAX_RECTS } from "./glassShader.ts";
import { BAR_PLUS_FS } from "./glassPlusShader.ts";

const paint = readFileSync(new URL("./BarGlass.tsx", import.meta.url), "utf8");

test("Liquid Glass + is a program of its own over the shared rounded box and luma, redeclaring nothing of the shared glass", () => {
  assert.ok(BAR_PLUS_FS.startsWith("#version 300 es\n"));
  assert.equal(BAR_PLUS_FS.split(GLASS_GLSL).length, 2);
  const own = BAR_PLUS_FS.replace(GLASS_GLSL, "");
  assert.ok(own.includes(`uniform vec4 uRects[${MAX_RECTS}];`) && own.includes("out vec4 o;"));
  assert.doesNotMatch(own, /\b(IOR|SLOPE|SAT|LIGHT|SPEC|GLOSS)\s*=/);
  assert.doesNotMatch(own, /\b(float|vec2)\s+(sdRound|luma|bend|shine)\s*\(/);
});

test("every uniform Liquid Glass + declares is set by the bar's paint with the call its type takes, so a misspelled or missing one cannot fail silently", () => {
  const decl = [...BAR_PLUS_FS.matchAll(/^uniform (\w+) (\w+)/gm)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(decl, ["sampler2D uTex", "vec2 uRes", "float uDpr", "vec2 uTexScale", "vec2 uTexOffset", "vec4 uRects", "int uCount", "float uRadius", "float uDocked", "vec2 uLens", "vec2 uLod", "float uVeilLod", "vec3 uTint", "float uTarget", "float uSpec"]);
  // Shared with Glass, set before the branch.
  for (const call of ["uniform2f(u.uRes,", "uniform1f(u.uDpr,", "uniform2f(u.uTexScale,", "uniform2f(u.uTexOffset,", 'uniform4fv(u["uRects[0]"],', "uniform1i(u.uCount,", "uniform1f(u.uRadius,"])
    assert.ok(paint.includes(`gl.${call}`), call);
  // Liquid Glass +'s own, inside its branch: Glass's branch sets a uLod of its own, so a search of the whole file would miss a gap here.
  const at = paint.indexOf("if (plus) {"), end = paint.indexOf("} else {", at);
  assert.ok(at > 0 && end > at, "no if (plus) { ... } else { ... } in paint");
  const own = paint.slice(at, end);
  for (const call of ["uniform1f(u.uDocked,", "uniform2f(u.uLens,", "uniform2f(u.uLod,", "uniform1f(u.uVeilLod,", "uniform3f(u.uTint,", "uniform1f(u.uTarget,", "uniform1f(u.uSpec,"])
    assert.ok(own.includes(`gl.${call}`), call);
});

test("every uniform Liquid Glass + declares is set by the notch's tool bar pass, which turns blending and the scissor off again", () => {
  const notch = readFileSync(new URL("../../../notch/glass/GlassLayer.tsx", import.meta.url), "utf8");
  // From the pass's own block, after the panel's draw: the panel's part of paint sets uRes, uLod and others of its own.
  const at = notch.indexOf("if (plusBar) {"), end = notch.indexOf("const draw = () =>", at);
  assert.ok(at > 0 && end > at, "no if (plusBar) { ... } before draw in GlassLayer.tsx");
  assert.ok(notch.lastIndexOf("gl.drawArrays(", at) > 0, "the plus pass comes after the panel's draw");
  const pass = notch.slice(at, end);
  for (const call of [
    "uniform2f(u.uRes,", "uniform1f(u.uDpr,", "uniform2f(u.uTexScale,", "uniform2f(u.uTexOffset,", 'uniform4fv(u["uRects[0]"],', "uniform1i(u.uCount,", "uniform1f(u.uRadius,",
    "uniform1f(u.uDocked,", "uniform2f(u.uLens,", "uniform2f(u.uLod,", "uniform1f(u.uVeilLod,", "uniform3f(u.uTint,", "uniform1f(u.uTarget,", "uniform1f(u.uSpec,",
  ])
    assert.ok(pass.includes(`gl.${call}`), call);
  const on = pass.indexOf("gl.enable(gl.BLEND)"), drawn = pass.indexOf("gl.drawArrays(");
  assert.ok(on > 0 && drawn > on, "the pass blends its draw");
  for (const off of ["gl.disable(gl.BLEND)", "gl.disable(gl.SCISSOR_TEST)"]) assert.ok(pass.indexOf(off) > drawn, off);
});

test("only Liquid Glass + picks another program, so switching between Crest's and Material's Glass keeps the renderer and its frame", () => {
  const setup = /const g = startBarGlass\([\s\S]*?\}, \[(.*?)\]\);/.exec(paint);
  assert.ok(setup, "no renderer setup effect");
  assert.equal(setup[1], 'props.look === "plus"');
  assert.match(paint, /program\(gl, look === "plus" \? BAR_PLUS_FS : BAR_FS\)/);
  // The radius still changes with the look, and a new look's first paint clears the old one's last frame.
  assert.match(paint, /\[shape, boxes, radius, veil, dark, reduced, dpr, look, edge\]\);/);
});
