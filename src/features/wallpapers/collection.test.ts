import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { COLLECTION, bytesOf } from "./collection.ts";

const assets = new URL("../../assets/wallpapers/", import.meta.url);

test("the collection: 18 Unsplash photos by their 16 authors and 6 of unknown source, each with a safe id", () => {
  assert.equal(COLLECTION.length, 24);
  assert.equal(new Set(COLLECTION.map((p) => p.id)).size, 24);
  for (const p of COLLECTION) assert.match(p.id, /^[A-Za-z0-9_-]{1,64}$/);
  assert.deepEqual([...COLLECTION.map((p) => p.id)].sort(), COLLECTION.map((p) => p.id));
  const unsplash = COLLECTION.filter((p) => p.author !== null);
  assert.equal(unsplash.length, 18);
  for (const p of unsplash) assert.equal(p.photo, p.id.slice(-11), p.id);
  const unknown = COLLECTION.filter((p) => p.author === null);
  assert.deepEqual(unknown.map((p) => [p.id, p.photo]), ["629958", "809524", "884853", "885155", "99789", "99790"].map((id) => [id, null]));
  assert.deepEqual([...new Set(unsplash.map((p) => p.author))].sort(), [
    "A Chosen Soul", "Alexander Lunyov", "Andrei Castanha", "Birmingham Museums Trust", "Dim Gunger", "Dynamic Wang", "Johny Goerend", "Jonas Denil",
    "Kerensa Pickett", "Milad Fakurian", "Pawel Czerwinski", "Peter Olexa", "Richard Horvath", "SIMON LEE", "Shubham Dhage", "Steven Lynn",
  ].sort());
  assert.equal(unsplash.filter((p) => p.author === "Pawel Czerwinski").length, 3);
});

test("every picture has its thumbnail and every thumbnail a picture; the credits name each one", () => {
  const thumbs = readdirSync(assets).filter((f) => f.endsWith(".jpg")).map((f) => f.slice(0, -4)).sort();
  assert.deepEqual(thumbs, COLLECTION.map((p) => p.id));
  const credits = readFileSync(new URL("CREDITS.md", assets), "utf8");
  for (const p of COLLECTION) {
    if (p.photo) assert.ok(credits.includes(`Photo by ${p.author} on Unsplash, https://unsplash.com/photos/${p.photo}`), p.id);
    else assert.ok(credits.includes(`- ${p.id}:`), p.id);
  }
});

test("the full-size pictures' sizes add up", () => {
  for (const p of COLLECTION) assert.ok(p.bytes > 100_000 && p.bytes < 16 * 1024 * 1024, p.id);
  assert.equal(bytesOf([]), 0);
  assert.equal(bytesOf(["809524", "99790"]), 385247 + 208499);
  assert.equal(bytesOf(["unknown"]), 0);
});
