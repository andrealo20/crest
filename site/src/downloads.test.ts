import assert from "node:assert/strict";
import test from "node:test";
import { summarize } from "./downloads.ts";

test("summarize adds up every file of every release, as the README's badge does", () => {
  const d = summarize(
    [
      { assets: [{ download_count: 300 }, { download_count: 70 }, { download_count: 2500 }] },
      { assets: [{ download_count: 6 }] },
      { assets: [] },
    ],
    new Date("2026-11-27T10:00:00Z"),
  );
  assert.deepEqual(d, { read: "2026-11-27T10:00:00.000Z", total: 2876 });
});
