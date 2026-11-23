import { test } from "node:test";
import assert from "node:assert/strict";
import { FAN_MAX, NO_FANS, NO_TEMPS, TEMP_POINTS, addTemps, fansOf, tempsFeed } from "./thermals.ts";

test("a read opens the bucket of its 15 s at whole degrees; the same bucket keeps its hottest value", () => {
  let line = addTemps(NO_TEMPS, 31_000, 61.6, null);
  assert.deepEqual(line, { bucket: 2, cpu: [62], gpu: [null] });
  line = addTemps(line, 32_000, 58, null);
  assert.deepEqual(line.cpu, [62]);
  line = addTemps(line, 40_000, 66, 50);
  assert.deepEqual(line, { bucket: 2, cpu: [66], gpu: [50] });
  line = addTemps(line, 44_999, null, null);
  assert.deepEqual(line, { bucket: 2, cpu: [66], gpu: [50] });
});

test("each bucket passed without a read is a gap", () => {
  let line = addTemps(NO_TEMPS, 31_000, 66, null);
  line = addTemps(line, 46_000, 60, null);
  assert.deepEqual(line.cpu, [66, 60]);
  line = addTemps(line, 95_000, 70, null);
  assert.deepEqual(line, { bucket: 6, cpu: [66, 60, null, null, 70], gpu: [null, null, null, null, null] });
});

test("the line keeps the last 40 points, the oldest leaving first, and a long pause leaves only gaps before the new value", () => {
  let line = NO_TEMPS;
  for (let i = 0; i < 45; i++) line = addTemps(line, i * 15_000, 40 + i, i);
  assert.equal(line.cpu.length, TEMP_POINTS);
  assert.equal(line.cpu[0], 45);
  assert.equal(line.cpu.at(-1), 84);
  assert.equal(line.gpu.length, line.cpu.length);
  line = addTemps(line, (44 + 100) * 15_000, 50, null);
  assert.deepEqual(line.cpu, [...Array<null>(39).fill(null), 50]);
  assert.deepEqual(line.gpu, Array<null>(40).fill(null));
});

test("the fans from HWiNFO or LibreHardwareMonitor beat the driver's, to 10 rpm, and a broken reading is none", () => {
  const spun = new Set<string>();
  assert.deepEqual(fansOf({ cpu: 1234, case: 721, gpu: 880 }, { key: "a", fan: 1500 }, null, spun), { cpu: 1230, gpu: 880, case: 720 });
  assert.deepEqual(fansOf({ cpu: 65535, case: null, gpu: null }, null, null, spun), NO_FANS);
  assert.ok(FAN_MAX < 65535);
  assert.deepEqual(fansOf(null, null, null, spun), NO_FANS);
});

test("the driver's GPU fan counts once it has spun since Crest started: before, 0 is a driver that does not report it", () => {
  const spun = new Set<string>();
  assert.equal(fansOf(null, { key: "a", fan: 0 }, null, spun).gpu, null);
  assert.equal(fansOf(null, { key: "a", fan: 1340 }, null, spun).gpu, 1340);
  assert.equal(fansOf(null, { key: "a", fan: 0 }, null, spun).gpu, 0);
  // Another adapter has not spun yet.
  assert.equal(fansOf(null, { key: "b", fan: 0 }, null, spun).gpu, null);
  assert.equal(fansOf(null, { key: "a", fan: 70000 }, null, spun).gpu, null);
});

test("without rpm the GPU's fan comes from NVML in percent, at most 100", () => {
  const spun = new Set<string>();
  assert.deepEqual(fansOf(null, { key: "a", fan: 0 }, 45.4, spun), { cpu: null, gpu: 45, case: null, gpuPercent: true });
  assert.deepEqual(fansOf(null, null, 130, spun), { cpu: null, gpu: 100, case: null, gpuPercent: true });
  // A driver that reports rpm, or a monitoring program, wins.
  assert.equal(fansOf(null, { key: "a", fan: 900 }, 45, spun).gpuPercent, undefined);
  assert.equal(fansOf({ cpu: null, case: null, gpu: 700 }, null, 45, spun).gpu, 700);
});

test("the feed's line keeps each series once it has shown a value, so a resting GPU keeps its column", () => {
  const seen = new Set<"cpu" | "gpu">();
  let line = addTemps(NO_TEMPS, 0, 61.6, null);
  assert.deepEqual(tempsFeed(line, 61.6, null, seen), { cpu: 62, gpu: null, cpuLine: [62], gpuLine: [], fans: NO_FANS });
  line = addTemps(line, 15_000, 60, 48);
  assert.deepEqual(tempsFeed(line, 60, 48.4, seen).gpuLine, [null, 48]);
  // Ten minutes and more without the GPU: its line is all gaps, but it stays.
  for (let i = 2; i < 50; i++) line = addTemps(line, i * 15_000, 60, null);
  assert.deepEqual(tempsFeed(line, 60, null, seen).gpuLine, Array<null>(40).fill(null));
});
