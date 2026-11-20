import { test } from "node:test";
import assert from "node:assert/strict";
import { readSpot, savedMoves } from "./moves.ts";

test("a saved spot comes back with the pixel ratio the timer had there", () => {
  assert.deepEqual(readSpot('{"x":1440,"y":300,"dpr":1.5}'), { x: 1440, y: 300, dpr: 1.5 });
  assert.deepEqual(readSpot('{"x":1500,"y":300}'), { x: 1500, y: 300 }, "saved before the ratio was");
  assert.deepEqual(readSpot('{"x":-500,"y":100,"dpr":"2"}'), { x: -500, y: 100 }, "a ratio that is not a number is left out");
  assert.deepEqual(readSpot('{"x":10,"y":20,"dpr":0}'), { x: 10, y: 20 });
});

test("a broken saved spot is none", () => {
  for (const raw of [null, "", "nope", "null", '{"x":"1","y":2}', '{"x":1}', "[1,2]"]) assert.equal(readSpot(raw), null, String(raw));
});

test("a move Crest announced is not saved, and the user's next one is", () => {
  const moves = savedMoves();
  moves.placed(1416, 72);
  assert.equal(moves.save(1416, 72), false, "Crest's own move, following the Text size");
  assert.equal(moves.save(1416, 72), true, "a later drag that ends on the same pixel");
});

test("a drag is saved, also while an announced move is still to come", () => {
  const moves = savedMoves();
  assert.equal(moves.save(800, 500), true);
  moves.placed(1416, 72);
  assert.equal(moves.save(810, 505), true, "the user dragged first");
  assert.equal(moves.save(1416, 72), true, "the announcement went with the drag");
});
