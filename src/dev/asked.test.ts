import { test } from "node:test";
import assert from "node:assert/strict";
import { hasFixedWords } from "./asked.ts";

test("the fixed words of the template are found, in order", () => {
  assert.ok(hasFixedWords("Translate into French: hello", "Translate into {lang}: {x}"));
  assert.ok(hasFixedWords("次の内容を英語に翻訳してください: こんにちは", "次の内容を{lang}に翻訳してください: {x}"));
  assert.ok(!hasFixedWords("Please translate this", "Translate into {lang}: {x}"));
  assert.ok(!hasFixedWords("French into Translate: hello", "Translate into {lang}: {x}"));
});

test("a template that opens with a placeholder does not match every question", () => {
  assert.ok(!hasFixedWords("What is the capital of France?", "{lang} में अनुवाद करें: {x}"));
  assert.ok(hasFixedWords("हिन्दी में अनुवाद करें: hello", "{lang} में अनुवाद करें: {x}"));
});

test("a template with nothing fixed matches nothing", () => {
  assert.ok(!hasFixedWords("anything", "{x}"));
});
