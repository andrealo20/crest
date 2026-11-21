import { test } from "node:test";
import assert from "node:assert/strict";
import { diskSize } from "../system/format.ts";
import { barDisks, lowSpace, orderDisks, usedShare, type DiskDrive } from "./disks.ts";

const GB = 1024 ** 3;
const drive = (letter: string, free: number, total: number, more: Partial<DiskDrive> = {}): DiskDrive => ({ letter, name: "", total: total * GB, free: free * GB, removable: false, system: false, ...more });

const c = drive("C:", 200, 1000, { system: true });
const d = drive("D:", 50, 2000);
const usb = drive("E:", 1, 64, { removable: true });

test("the panel lists internal drives first, then the removable ones, each by letter", () => {
  const stick = drive("B:", 10, 32, { removable: true });
  assert.deepEqual(orderDisks([usb, d, stick, c]).map((x) => x.letter), ["C:", "D:", "B:", "E:"]);
  assert.deepEqual(orderDisks([]), []);
});

test("each version picks its drives: the system one, all of them, the fullest", () => {
  const list = [usb, d, c];
  assert.deepEqual(barDisks(list, "system"), [c]);
  assert.deepEqual(barDisks(list, "all").map((x) => x.letter), ["C:", "D:", "E:"]);
  // E: is 98 % used, D: 97.5 %, C: 80 %.
  assert.deepEqual(barDisks(list, "fullest"), [usb]);
  // No drive marked as the system's: the first internal one.
  assert.deepEqual(barDisks([usb, d], "system"), [d]);
  // Nothing read yet: nothing drawn.
  for (const v of ["system", "all", "fullest"] as const) assert.deepEqual(barDisks([], v), []);
  // A tie goes to the first in the panel's order.
  assert.deepEqual(barDisks([drive("F:", 10, 100), drive("A:", 10, 100)], "fullest").map((x) => x.letter), ["A:"]);
});

test("a drive turns red under 10 % free", () => {
  assert.equal(lowSpace(drive("C:", 9.9, 100)), true);
  assert.equal(lowSpace(drive("C:", 10, 100)), false);
  assert.equal(lowSpace(drive("C:", 0, 100)), true);
  // A drive that reports no size is never red, and its bar stays empty.
  assert.equal(lowSpace(drive("C:", 0, 0)), false);
  assert.equal(usedShare(drive("C:", 0, 0)), 0);
  // More free than its size (a bad read): empty, not negative.
  assert.equal(usedShare(drive("C:", 200, 100)), 0);
  assert.equal(usedShare(drive("C:", 25, 100)), 0.75);
});

test("free space reads in at most three figures and a binary unit", () => {
  assert.equal(diskSize(0), "0 MB");
  assert.equal(diskSize(512 * 1024 ** 2), "512 MB");
  assert.equal(diskSize(999 * 1024 ** 2), "999 MB");
  assert.equal(diskSize(1000 * 1024 ** 2), "1.0 GB");
  assert.equal(diskSize(9.5 * GB), "9.5 GB");
  assert.equal(diskSize(9.96 * GB), "10 GB");
  assert.equal(diskSize(214 * GB), "214 GB");
  assert.equal(diskSize(999 * GB), "999 GB");
  assert.equal(diskSize(1.2 * 1024 * GB), "1.2 TB");
  assert.equal(diskSize(12 * 1024 * GB), "12 TB");
  assert.equal(diskSize(Number.NaN), "0 MB");
  assert.equal(diskSize(-5), "0 MB");
});
