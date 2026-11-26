import { mock, test } from "node:test";
import assert from "node:assert/strict";
import type { FoundFile } from "../../../platform/services.ts";
import { fileHits, latestSearch } from "./files.ts";

const file = (name: string): FoundFile => ({ path: `C:\\x\\${name}`, name, folder: false });
const flush = () => new Promise((r) => setImmediate(r));

test("only the last text is asked, once the typing pauses", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const asked: string[] = [];
  const got: string[] = [];
  const search = latestSearch(
    async (q) => {
      asked.push(q);
      return [file(`${q}.txt`)];
    },
    (q) => got.push(q),
    120,
  );
  search("ho");
  mock.timers.tick(50);
  search("hol");
  mock.timers.tick(120);
  await flush();
  assert.deepEqual(asked, ["hol"]);
  assert.deepEqual(got, ["hol"]);
  mock.timers.reset();
});

test("a slow answer for older text is dropped once newer text was asked", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const answer = new Map<string, (found: FoundFile[]) => void>();
  const got: string[] = [];
  const search = latestSearch((q) => new Promise((r) => answer.set(q, r)), (q) => got.push(q), 120);
  search("a");
  mock.timers.tick(120);
  search("ab");
  mock.timers.tick(120);
  answer.get("ab")?.([]);
  await flush();
  answer.get("a")?.([file("a.txt")]);
  await flush();
  assert.deepEqual(got, ["ab"]);
  mock.timers.reset();
});

test("no text asks nothing and empties the files at once", () => {
  const got: [string, number][] = [];
  const search = latestSearch(async () => [file("x")], (q, found) => got.push([q, found.length]), 120);
  search("  ");
  assert.deepEqual(got, [["  ", 0]]);
});

test("names starting with the text come first; Enter opens a file, Ctrl+Enter shows it in its folder", () => {
  const hits = fileHits([file("my holiday.jpg"), file("holiday.mp4")], "holiday");
  assert.deepEqual(hits.map((h) => h.title), ["holiday.mp4", "my holiday.jpg"]);
  assert.equal(hits[0]?.subtitle, "C:\\x");
  assert.deepEqual(hits[0]?.action, { do: "file", path: "C:\\x\\holiday.mp4" });
  assert.deepEqual(hits[0]?.alt, { do: "reveal", path: "C:\\x\\holiday.mp4" });
});
