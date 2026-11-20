import { test } from "node:test";
import assert from "node:assert/strict";
import { savedMoves } from "./moves.ts";

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
