import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLanguage, modelCode, pairsFor, translationLrc } from "./offline.ts";

test("models go through English unless one side is English", () => {
  assert.deepEqual(pairsFor("ja", "it"), [["ja", "en"], ["en", "it"]]);
  assert.deepEqual(pairsFor("ja", "en"), [["ja", "en"]]);
  assert.deepEqual(pairsFor("en", "it"), [["en", "it"]]);
  assert.deepEqual(pairsFor("it", "it"), []);
  assert.equal(modelCode("pt-BR"), "pt");
  assert.equal(modelCode("zh-CN"), "zh");
});

test("a song's language from its script or its common words", () => {
  assert.equal(detectLanguage(["沈むように溶けてゆくように", "二人だけの空が広がる夜に"]), "ja");
  assert.equal(detectLanguage(["너를 사랑해", "오늘 밤에 baby"]), "ko");
  assert.equal(detectLanguage(["我们的爱情", "在夜里慢慢消失"]), "zh");
  assert.equal(detectLanguage(["Я тебя люблю", "и ты меня"]), "ru");
  assert.equal(detectLanguage(["I keep on fallin' in and out", "Of love with you", "I never loved someone the way that I love you", "you make me feel"]), "en");
  assert.equal(detectLanguage(["Yo no sé qué me pasa", "cuando estoy contigo", "te quiero con todo mi amor", "y no puedo vivir sin ti"]), "es");
  assert.equal(detectLanguage(["Je ne sais pas pourquoi", "tu es dans mon cœur", "et c'est pour toi que je chante", "les jours passent"]), "fr");
  // Too little to tell.
  assert.equal(detectLanguage(["Oh oh", "yeah"]), null);
  assert.equal(detectLanguage([""]), null);
});

test("translations as LRC on the lines' stamps", () => {
  const lines = [{ time: 1.43, text: "夜に" }, { time: 65.2, text: "" }, { time: 70, text: "駆ける" }];
  assert.equal(translationLrc(lines, ["At night", null, "Run"]), "[00:01.43]At night\n[01:10.00]Run\n");
  assert.equal(translationLrc(lines, [null, null, null]), null);
});
