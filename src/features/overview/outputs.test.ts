import { test } from "node:test";
import assert from "node:assert/strict";
import { outputIcon } from "./outputs.ts";

test("output icon from the device name", () => {
  assert.equal(outputIcon("Headphones (WH-1000XM5)"), "headphones");
  assert.equal(outputIcon("Headset Earphone (Jabra Evolve2)"), "headphones");
  assert.equal(outputIcon("Galaxy Buds2 Pro"), "headphones");
  assert.equal(outputIcon("Casque (AirPods Pro)"), "headphones");
  assert.equal(outputIcon("Speakers (Realtek(R) Audio)"), "speaker-hifi");
  assert.equal(outputIcon("Lautsprecher (Realtek(R) Audio)"), "speaker-hifi");
  assert.equal(outputIcon("Наушники (Realtek Audio)"), "headphones");
  assert.equal(outputIcon("ヘッドホン (WH-1000XM5)"), "headphones");
  assert.equal(outputIcon("耳机 (Realtek Audio)"), "headphones");
  assert.equal(outputIcon("हेडफ़ोन (Realtek Audio)"), "headphones");
  assert.equal(outputIcon("سماعات الرأس (Realtek Audio)"), "headphones");
  assert.equal(outputIcon("Динамики (Realtek Audio)"), "speaker-hifi");
  assert.equal(outputIcon("スピーカー (Realtek Audio)"), "speaker-hifi");
  assert.equal(outputIcon("扬声器 (Realtek Audio)"), "speaker-hifi");
  assert.equal(outputIcon("स्पीकर (Realtek Audio)"), "speaker-hifi");
  assert.equal(outputIcon("مكبرات الصوت (Realtek Audio)"), "speaker-hifi");
  assert.equal(outputIcon("LG TV SSCR2 (NVIDIA High Definition Audio)"), "speaker");
  assert.equal(outputIcon(""), "speaker");
});
