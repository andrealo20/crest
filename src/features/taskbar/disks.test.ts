import { test } from "node:test";
import assert from "node:assert/strict";
import { diskSize } from "../system/format.ts";
import { SCAN_FRESH, barDisks, freshScan, lowSpace, orderDisks, scanProgress, scanRows, usedShare, type DiskDrive, type DiskScan, type ScanLevel, type ScanState } from "./disks.ts";

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

const scanOf = (folders: [string, number][], more: number, files: number, partial = false): DiskScan => ({ folders: folders.map(([name, size], id) => ({ id, name, size: size * GB })), more: more * GB, files: files * GB, partial });
const shown = (rows: ReturnType<typeof scanRows>) => rows.map((r) => [r.folder?.name ?? r.kind, Math.round(r.size / GB), Math.round(r.share * 1000) / 1000]);

test("a scan lists its folders, the rest, its own files and at a drive's root what no folder holds, largest first", () => {
  const scan = scanOf([["Users", 182], ["Windows", 31]], 3, 18);
  assert.deepEqual(shown(scanRows(scan, 255 * GB, true)), [
    ["Users", 182, 0.714],
    ["Windows", 31, 0.122],
    ["other", 21, 0.082],
    ["files", 18, 0.071],
    ["more", 3, 0.012],
  ]);
  // A folder's page: what no folder holds is the drive's alone.
  assert.deepEqual(scanRows(scan, 255 * GB, false).map((r) => r.folder?.name ?? r.kind), ["Users", "Windows", "files", "more"]);
  // A walk that ended early read only part of the drive: the rest is not "System and unreadable".
  assert.deepEqual(scanRows(scanOf([["Users", 182]], 0, 18, true), 255 * GB, true).map((r) => r.folder?.name ?? r.kind), ["Users", "files"]);
});

test("what no folder holds never goes below zero", () => {
  // Hard links count once per link, so the sum can pass the used space: no other row, and the shares are of the sum.
  const rows = scanRows(scanOf([["Windows", 300], ["Users", 100]], 0, 0), 255 * GB, true);
  assert.deepEqual(shown(rows), [
    ["Windows", 300, 0.75],
    ["Users", 100, 0.25],
  ]);
  assert.ok(rows.every((r) => r.share <= 1));
  // Nothing at all: no rows, and no share divided by zero.
  assert.deepEqual(scanRows(scanOf([], 0, 0), 0, true), []);
});

test("a scan's answer stays ten minutes, a running scan always", () => {
  const level = (more: Partial<ScanLevel> = {}): ScanLevel => ({ token: 1, folder: null, title: "C:", of: 0, counted: 0, scan: null, error: null, ...more });
  const state = (levels: ScanLevel[]): ScanState => ({ letter: "C:", at: 1000, levels });
  const done = state([level({ scan: scanOf([], 0, 0) })]);
  assert.equal(freshScan(done, 1000 + SCAN_FRESH - 1), true);
  assert.equal(freshScan(done, 1000 + SCAN_FRESH), false);
  // The level on top runs: the page stays however long it takes.
  assert.equal(freshScan(state([level({ scan: scanOf([], 0, 0) }), level({ token: 2, folder: 0 })]), 1000 + 3 * SCAN_FRESH), true);
  // One that went wrong or found another scan running is not running.
  assert.equal(freshScan(state([level({ error: "busy" })]), 1000 + SCAN_FRESH), false);
  assert.equal(freshScan(state([level({ error: "failed" })]), 1000 + SCAN_FRESH - 1), true);
  assert.equal(freshScan(null, 0), false);
});

test("a scan's progress never passes the end and needs a size to measure against", () => {
  assert.equal(scanProgress(50, 200), 0.25);
  // Hard links can count more than the drive holds.
  assert.equal(scanProgress(300, 200), 1);
  assert.equal(scanProgress(10, 0), 0);
  assert.equal(scanProgress(-5, 200), 0);
});
