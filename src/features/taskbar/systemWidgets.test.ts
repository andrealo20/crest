import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProcReading } from "../../platform/services.ts";
import { NET_FLOOR, appFigure, batteryLit, linePoints, needleAngle, netMax, systemWant, topApp } from "./systemWidgets.ts";

const MiB = 1024 ** 2, GiB = 1024 ** 3;
const code: ProcReading = { id: "code.exe", name: "Visual Studio Code", path: null, count: 3, cpu: 240, mem: 1536 * MiB };

test("an app's share is its CPU over the machine's threads, or its memory over the machine's, at most 100 and to one decimal", () => {
  assert.deepEqual(topApp(code, false, 0, 8), { id: "code.exe", name: "Visual Studio Code", path: null, share: 30, mem: 1536 * MiB });
  assert.equal(topApp({ ...code, mem: 4 * GiB }, true, 16 * GiB, 8)?.share, 25);
  // No threads known: counted as one.
  assert.equal(topApp({ ...code, cpu: 12.34 }, false, 0, 0)?.share, 12.3);
  assert.equal(topApp({ ...code, cpu: 2000 }, false, 0, 8)?.share, 100);
  // The machine's memory not known yet: no share rather than a division by zero.
  assert.equal(topApp(code, true, 0, 8)?.share, 0);
});

test("the CPU version waits for a second reading, since the first list after a start reads 0 for every process; memory does not", () => {
  assert.equal(topApp({ ...code, cpu: 0 }, false, 16 * GiB, 8), null);
  assert.notEqual(topApp({ ...code, cpu: 0 }, true, 16 * GiB, 8), null);
});

test("an app's memory is kept to whole MiB, so its slice changes only when its figure could", () => {
  assert.equal(topApp({ ...code, mem: 1_500_000_000 }, false, 0, 8)?.mem, 1_500_512_256);
});

test("an app's figure is its share in percent, one decimal under 10, or its memory", () => {
  const app = topApp(code, false, 0, 8)!;
  assert.equal(appFigure(app, false), "30%");
  assert.equal(appFigure({ ...app, share: 7.4 }, false), "7.4%");
  assert.equal(appFigure(app, true), "1.5G");
  assert.equal(appFigure({ ...app, mem: 412 * MiB }, true), "412M");
});

test("a line's points fill its box, the bottom at 0 and the top at the maximum, gaps skipped", () => {
  assert.deepEqual(linePoints([0, 50, 100], 100), [[0, 15], [20, 8], [40, 1]]);
  assert.deepEqual(linePoints([0, null, Number.NaN, 100], 100), [[0, 15], [40, 1]]);
  assert.deepEqual(linePoints([150, -5], 100), [[0, 1], [40, 15]]);
  assert.deepEqual(linePoints([], 100), []);
});

test("the network's line scales to the busier of download and upload, never under 100 KB/s, so a quiet link stays low", () => {
  assert.equal(NET_FLOOR, 100_000);
  assert.equal(netMax([], []), 100_000);
  assert.equal(netMax([20_000, null], [5_000]), 100_000);
  assert.equal(netMax([2_400_000, 1_000_000], [180_000]), 2_400_000);
  assert.equal(netMax([10], [300_000]), 300_000);
});

test("a battery's parts light up to its charge, the first as soon as there is any, none while it is unknown", () => {
  assert.deepEqual([null, 0, 1, 20, 21, 100, 130, -3].map((p) => batteryLit(p, 5)), [0, 0, 1, 1, 2, 5, 5, 0]);
  assert.equal(batteryLit(55, 10), 6);
  assert.equal(batteryLit(9, 10), 1);
});

test("the gauge's needle points left when empty, up at half and right when full", () => {
  assert.deepEqual([0, 50, 100, null, 140].map(needleAngle), [-90, 0, 90, -90, 90]);
});

test("the system store reads the closed row's extras while they show, and for the bar's Hardware, network line and Top apps", () => {
  const r = { cpu: true, ram: true, gpu: true, net: true, power: false, battery: false, temp: true };
  const off = { net: false, temps: false, power: false, battery: false, processes: false };
  assert.deepEqual(systemWant(true, r, [], "dials"), { ...off, net: true, temps: true });
  // Power is worked out with the battery's discharge.
  assert.deepEqual(systemWant(true, { ...r, net: false, temp: false, power: true }, [], "dials"), { ...off, power: true, battery: true });
  assert.deepEqual(systemWant(false, r, [], "dials"), off);
  assert.deepEqual(systemWant(false, r, ["readings"], "dials"), { ...off, net: true, temps: true });
  // The network's line reads the network with NET off for the notch, but only while the Hardware widget is on the bar.
  assert.deepEqual(systemWant(false, { ...r, net: false }, ["readings"], "net"), { ...off, temps: true, net: true });
  assert.deepEqual(systemWant(false, { ...r, net: false }, [], "net"), off);
  assert.deepEqual(systemWant(false, r, ["processes"], "dials"), { ...off, processes: true });
});
