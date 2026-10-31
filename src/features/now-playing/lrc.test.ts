import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheKey, lineAt, lyricsOf, parseLrc, pickRecord, searchTerms, untilNext } from "./lrc.ts";

test("parses stamps, repeats, offset and tags", () => {
  const lines = parseLrc("[ar:Someone]\n[ti:Song]\n[00:12.50]First\r\n[00:05.00][01:02.3]Chorus  again\n[00:20.000]\nno stamp\n[1:03:5]x");
  assert.deepEqual(lines, [
    { time: 5, text: "Chorus again" },
    { time: 12.5, text: "First" },
    { time: 20, text: "" },
    { time: 62.3, text: "Chorus again" },
    { time: 63.5, text: "x" },
  ]);
  const shifted = parseLrc("[offset:+500]\n[00:01.00]a\n[00:00.20]b");
  assert.deepEqual(shifted.map((l) => l.time), [0, 0.5]);
  assert.deepEqual(parseLrc("[offset:-1000]\n[00:01.00]a").map((l) => l.time), [2]);
  // Enhanced LRC word stamps are dropped.
  assert.equal(parseLrc("[00:01.00]<00:01.00>Hello <00:01.50>world")[0].text, "Hello world");
  assert.deepEqual(parseLrc(""), []);
});

test("line at a time", () => {
  const lines = parseLrc("[00:01.00]a\n[00:03.00]b\n[00:03.00]b2\n[00:07.00]c");
  assert.equal(lineAt(lines, 0), -1);
  assert.equal(lineAt(lines, 1), 0);
  assert.equal(lineAt(lines, 2.99), 0);
  assert.equal(lineAt(lines, 3), 2);
  assert.equal(lineAt(lines, 100), 3);
  assert.equal(lineAt([], 5), -1);
  assert.equal(untilNext(lines, -1, 0.5), 0.5);
  assert.equal(untilNext(lines, 2, 4), 3);
  assert.equal(untilNext(lines, 3, 8), Infinity);
});

test("query cleanup for browser players", () => {
  assert.deepEqual(searchTerms("Daft Punk - One More Time (Official Video)", "YouTube"), { title: "One More Time", artist: "Daft Punk" });
  assert.deepEqual(searchTerms("Adele - Hello [Lyrics]", ""), { title: "Hello", artist: "Adele" });
  assert.deepEqual(searchTerms("Hello", "Adele - Topic"), { title: "Hello", artist: "Adele" });
  assert.deepEqual(searchTerms("Taylor Swift - Shake It Off", "TaylorSwiftVEVO"), { title: "Shake It Off", artist: "Taylor Swift" });
  // A real artist keeps a title with a dash.
  assert.deepEqual(searchTerms("Song - Remastered 2011", "The Beatles"), { title: "Song - Remastered 2011", artist: "The Beatles" });
  // A title that is only noise stays as it was.
  assert.equal(searchTerms("(Official Video)", "X").title, "(Official Video)");
});

test("cache keys", () => {
  assert.equal(cacheKey("Hello", "Adele", 295.4), "adele\nhello\n295");
  assert.equal(cacheKey("  HELLO ", "adele", 295.6), "adele\nhello\n296");
  assert.equal(cacheKey("Adele - Hello (Official Video)", "Chrome", 0), "adele\nhello\n0");
  assert.notEqual(cacheKey("Hello", "Adele", 295), cacheKey("Hello", "Adele", 200));
  assert.equal(cacheKey("Ｈｅｌｌｏ", "Adele", -1), "adele\nhello\n0");
});

test("search result choice", () => {
  const recs = [
    { duration: 200, syncedLyrics: "[00:01.00]a" },
    { duration: 296, syncedLyrics: null, plainLyrics: "x" },
    { duration: 293, syncedLyrics: "[00:01.00]b" },
    { duration: 295, syncedLyrics: "  " },
  ];
  assert.equal(pickRecord(recs, 295)?.duration, 293);
  assert.equal(pickRecord(recs, 400), null);
  assert.equal(pickRecord(recs, 0)?.duration, 200);
  assert.equal(pickRecord("nope", 10), null);
  assert.equal(pickRecord([null, 3, {}], 10), null);
});

test("what a record means", () => {
  assert.deepEqual(lyricsOf({ instrumental: true, syncedLyrics: null }), { kind: "instrumental" });
  assert.deepEqual(lyricsOf(null), { kind: "none" });
  assert.deepEqual(lyricsOf({ syncedLyrics: "[00:01.00]\n[00:02.00]" }), { kind: "none" });
  assert.deepEqual(lyricsOf({ syncedLyrics: "[00:01.00]a" }), { kind: "synced", lines: [{ time: 1, text: "a" }] });
});
