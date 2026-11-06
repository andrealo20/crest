import { test } from "node:test";
import assert from "node:assert/strict";
import { lastWins } from "./lastWins.ts";

test("one send in flight, the newer patches merge into the next, a failure does not stop the queue", async () => {
  const sent: object[] = [];
  const done: (() => void)[] = [];
  const send = lastWins((p: { level?: number; muted?: boolean }) => {
    sent.push(p);
    return new Promise<void>((resolve, reject) => done.push(sent.length === 1 ? () => reject(new Error("no device")) : resolve));
  });
  send({ level: 0.1 });
  send({ level: 0.2 });
  send({ muted: false });
  send({ level: 0.3 });
  assert.deepEqual(sent, [{ level: 0.1 }]);
  done[0]();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent, [{ level: 0.1 }, { level: 0.3, muted: false }]);
  done[1]();
  await new Promise((r) => setTimeout(r, 0));
  send({ level: 0.4 });
  assert.equal(sent.length, 3);
});
