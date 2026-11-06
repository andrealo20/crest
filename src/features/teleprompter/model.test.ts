import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CHARS, PROMPTER_DEFAULTS, SIZE, WPM, advance, clamp, clampText, countWords, formatClock, normalizePrompter, progress, pxPerSecond, remainingSeconds, stepWpm } from "./model.ts";

test("words are counted in Latin, mixed CJK and Hangul text", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("  \n\t "), 0);
  assert.equal(countWords("... -- !!"), 0);
  assert.equal(countWords("Hello, world"), 2);
  assert.equal(countWords("don't stop; state-of-the-art\nplan B"), 5);
  assert.equal(countWords("Zurich café naïve 24"), 4);
  // Two Han or kana characters make a word, an odd one rounds up.
  assert.equal(countWords("你好世界"), 2);
  assert.equal(countWords("你好世"), 2);
  assert.equal(countWords("こんにちは世界"), 4);
  assert.equal(countWords("カタカナー"), 3);
  assert.equal(countWords("Hello 世界你好 world"), 4);
  assert.equal(countWords("使用 Crest 开始"), 3);
  // Korean is spaced like Latin.
  assert.equal(countWords("안녕하세요 세계"), 2);
  // Emoji and punctuation are not words.
  assert.equal(countWords("ok \u{1F600} 。、！ ok"), 2);
});

test("speed converts words per minute through the laid-out text", () => {
  // 120 words in 600 px: 5 px per word, and 120 wpm is 2 words a second.
  assert.equal(pxPerSecond(120, 120, 600), 10);
  assert.equal(pxPerSecond(60, 120, 600), 5);
  // Doubling the text size (twice the height for the same words) doubles the speed in px.
  assert.equal(pxPerSecond(120, 120, 1200), 20);
  assert.equal(pxPerSecond(120, 0, 600), 0);
  assert.equal(pxPerSecond(120, 120, 0), 0);
  assert.equal(pxPerSecond(120, Number.NaN, 600), 0);
});

test("position moves by speed and time, within the script", () => {
  assert.equal(advance(0, 0.05, 40, 1000), 2);
  assert.equal(advance(998, 0.1, 40, 1000), 1000);
  // A stalled frame (a hidden window) moves it by at most 0.1 s.
  assert.equal(advance(0, 5, 40, 1000), 4);
  assert.equal(advance(10, -1, 40, 1000), 10);
  assert.equal(advance(10, 0.1, 40, 0), 0);
  assert.equal(clamp(-5, 100), 0);
  assert.equal(clamp(150, 100), 100);
  assert.equal(clamp(Number.NaN, 100), 0);
  assert.equal(progress(250, 1000), 0.25);
  assert.equal(progress(2000, 1000), 1);
  assert.equal(progress(10, 0), 0);
});

test("time left follows the position and the speed", () => {
  assert.equal(remainingSeconds(0, 600, 10), 60);
  assert.equal(remainingSeconds(450, 600, 10), 15);
  assert.equal(remainingSeconds(700, 600, 10), 0);
  assert.equal(remainingSeconds(0, 600, 0), 0);
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(0.2), "0:01");
  assert.equal(formatClock(59.4), "1:00");
  assert.equal(formatClock(125), "2:05");
  assert.equal(formatClock(3725), "1:02:05");
  assert.equal(formatClock(Number.POSITIVE_INFINITY), "0:00");
  assert.equal(formatClock(-3), "0:00");
});

test("the script stops at the limit and does not cut an emoji in half", () => {
  assert.equal(clampText("abc"), "abc");
  assert.equal(clampText("a".repeat(MAX_CHARS)).length, MAX_CHARS);
  assert.equal(clampText("a".repeat(MAX_CHARS + 10)).length, MAX_CHARS);
  const cut = clampText("a".repeat(MAX_CHARS - 1) + "\u{1F600}");
  assert.equal(cut.length, MAX_CHARS - 1);
  assert.equal(cut.at(-1), "a");
});

test("stored data is brought back to something valid", () => {
  assert.deepEqual(normalizePrompter(undefined), PROMPTER_DEFAULTS);
  assert.deepEqual(normalizePrompter("text"), PROMPTER_DEFAULTS);
  assert.deepEqual(normalizePrompter({ text: 5, wpm: "fast", size: null, mirror: "yes" }), PROMPTER_DEFAULTS);
  const kept = normalizePrompter({ text: "Hi", wpm: 200, size: 40, mirror: true });
  assert.deepEqual(kept, { text: "Hi", wpm: 200, size: 40, mirror: true });
  assert.equal(normalizePrompter({ wpm: 5 }).wpm, WPM.min);
  assert.equal(normalizePrompter({ wpm: 9999 }).wpm, WPM.max);
  assert.equal(normalizePrompter({ size: 1 }).size, SIZE.min);
  assert.equal(normalizePrompter({ size: 500 }).size, SIZE.max);
  assert.equal(normalizePrompter({ wpm: Number.NaN }).wpm, WPM.def);
  assert.equal(normalizePrompter({ text: "a".repeat(MAX_CHARS * 2) }).text.length, MAX_CHARS);
});

test("the speed steps stay in range", () => {
  assert.equal(stepWpm(140, 1), 150);
  assert.equal(stepWpm(140, -1), 130);
  assert.equal(stepWpm(WPM.max, 1), WPM.max);
  assert.equal(stepWpm(WPM.min, -1), WPM.min);
});
