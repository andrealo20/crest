import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CHARS, joinLines, linesOf, plan, providerPrompt, sourceOf, targetOf } from "./logic.ts";

const none = { engine: false, pairs: [] as [string, number, boolean][] };
const have = (...pairs: string[]) => ({ engine: true, pairs: pairs.map((p) => [p, 40_000_000, false] as [string, number, boolean]) });

test("the target is the tool's pick, then the setting, then Crest's language, then English", () => {
  assert.equal(targetOf("fr", "de", "it"), "fr");
  assert.equal(targetOf("", "de", "it"), "de");
  assert.equal(targetOf("", "", "pt-BR"), "pt");
  assert.equal(targetOf("", "", "zh-CN"), "zh");
  // Arabic and Hindi have no model offered here.
  assert.equal(targetOf("", "", "ar"), "en");
  assert.equal(targetOf("xx", "", "hi"), "en");
});

test("a short sentence is recognised, an unclear one asks for the language", () => {
  assert.equal(sourceOf("auto", "Ich habe heute keine Zeit, und du?"), "de");
  assert.equal(sourceOf("auto", "Non ho tempo per te"), "it");
  assert.equal(sourceOf("auto", "今日は天気がいいですね"), "ja");
  assert.equal(sourceOf("auto", "Привет, как дела?"), "ru");
  assert.equal(sourceOf("auto", "Ciao"), null);
  assert.equal(sourceOf("auto", "12345 !!"), null);
  // A language picked by hand stands, whatever the text.
  assert.equal(sourceOf("es", "Ciao"), "es");
  assert.equal(sourceOf("xx", "Ciao"), null);
});

test("the local models come first, even with the provider on", () => {
  assert.deepEqual(plan("Hallo Welt", "de", "en", have("de-en"), true), { kind: "local", pairs: [["de", "en"]] });
  // Two languages other than English go through it, with both models.
  assert.deepEqual(plan("Ciao", "it", "de", have("it-en", "en-de"), false), { kind: "local", pairs: [["it", "en"], ["en", "de"]] });
});

test("a missing model is offered for download, or the provider translates once it is turned on", () => {
  assert.deepEqual(plan("Ciao", "it", "de", have("it-en"), false), { kind: "download", pairs: [["it", "en"], ["en", "de"]], missing: 1 });
  assert.deepEqual(plan("Ciao", "it", "de", none, false), { kind: "download", pairs: [["it", "en"], ["en", "de"]], missing: 2 });
  // The engine missing with the models there: a download brings it.
  assert.equal(plan("Hallo", "de", "en", { engine: false, pairs: have("de-en").pairs }, false).kind, "download");
  assert.deepEqual(plan("Ciao", "it", "de", none, true), { kind: "provider", from: "it" });
});

test("an unclear language goes to the provider when it is on, otherwise the user picks it", () => {
  assert.deepEqual(plan("Ciao", null, "en", have("it-en"), true), { kind: "provider", from: null });
  assert.deepEqual(plan("Ciao", null, "en", have("it-en"), false), { kind: "pick" });
});

test("nothing to do for an empty text, the same language, or a text over the limit", () => {
  assert.equal(plan("  \n ", "de", "en", have("de-en"), true).kind, "empty");
  assert.equal(plan("Hello", "en", "en", have(), true).kind, "same");
  assert.equal(plan("a".repeat(MAX_CHARS), "de", "en", have("de-en"), false).kind, "local");
  assert.equal(plan("a".repeat(MAX_CHARS + 1), "de", "en", have("de-en"), true).kind, "too-long");
});

test("lines go to the models without the empty ones and come back in their place", () => {
  const text = "Hallo\n\n  Wie geht's?  \n";
  const { lines, at } = linesOf(text);
  assert.deepEqual(lines, ["Hallo", "Wie geht's?"]);
  assert.deepEqual(at, [0, 2]);
  assert.equal(joinLines(text, at, ["Hello", "How are you?"]), "Hello\n\nHow are you?\n");
});

test("the provider is told the languages and to answer with the translation only", () => {
  assert.match(providerPrompt("it", "de"), /from Italian into German\./);
  assert.match(providerPrompt(null, "ja"), /message into Japanese\./);
  assert.match(providerPrompt(null, "ja"), /translation only/);
});
