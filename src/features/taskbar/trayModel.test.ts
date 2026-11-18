import { test } from "node:test";
import assert from "node:assert/strict";
import { splitTray } from "./trayModel.ts";

test("icons keep the order Andrea chose and the others go to the panel", () => {
  const i = (id: string) => ({ id, key: id, tip: id, img: null });
  assert.deepEqual(splitTray([i("a"), i("b"), i("c")], ["c", "x", "a"]), { visible: [i("c"), i("a")], hidden: [i("b")] });
});

test("two icons with one id follow the same choice", () => {
  const i = (key: string) => ({ id: "same", key, tip: key, img: null });
  assert.deepEqual(splitTray([i("1"), i("2")], ["same"]), { visible: [i("1"), i("2")], hidden: [] });
});
