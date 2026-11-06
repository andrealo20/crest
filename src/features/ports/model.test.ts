import { test } from "node:test";
import assert from "node:assert/strict";
import { byPort, group, isLoopback, isWildcard, withEnded, type Outcome, type RawPort } from "./model.ts";

const sock = (port: number, addr: string, pid: number, extra: Partial<RawPort> = {}): RawPort => ({ port, addr, pid, name: "node.exe", path: null, canEnd: true, ...extra });

test("loopback and wildcard addresses", () => {
  for (const a of ["127.0.0.1", "127.0.0.2", "::1", "::ffff:127.0.0.1"]) assert.ok(isLoopback(a) && !isWildcard(a), a);
  for (const a of ["0.0.0.0", "::", "::ffff:0.0.0.0"]) assert.ok(isWildcard(a) && !isLoopback(a), a);
  for (const a of ["192.168.1.20", "fe80::1", "10.0.0.5", "1127.0.0.1"]) assert.ok(!isLoopback(a) && !isWildcard(a), a);
});

test("the IPv4 and IPv6 listeners of one program on one port are one row", () => {
  const rows = group([sock(3000, "::1", 7), sock(3000, "127.0.0.1", 7), sock(3000, "127.0.0.1", 7), sock(8080, "0.0.0.0", 9), sock(8080, "::", 9)]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].addrs, ["127.0.0.1", "::1"], "IPv4 first, a repeated socket once");
  assert.deepEqual(rows[1].addrs, ["0.0.0.0", "::"]);
  // The same port taken by two programs stays two rows.
  assert.equal(group([sock(80, "0.0.0.0", 1), sock(80, "0.0.0.0", 2)]).length, 2);
});

test("a row is exposed when any listener leaves the loopback, and opens when localhost answers", () => {
  const [local, wild, lan, both] = group([sock(1, "127.0.0.1", 1), sock(2, "0.0.0.0", 2), sock(3, "192.168.1.20", 3), sock(4, "127.0.0.1", 4), sock(4, "192.168.1.20", 4)]);
  assert.deepEqual([local.exposed, local.openable], [false, true]);
  assert.deepEqual([wild.exposed, wild.openable], [true, true]);
  assert.deepEqual([lan.exposed, lan.openable], [true, false], "an interface address may not answer on localhost");
  assert.deepEqual([both.exposed, both.openable], [true, true]);
});

test("a row can be ended only when every one of its sockets can", () => {
  const [row] = group([sock(3000, "127.0.0.1", 7), sock(3000, "::1", 7, { canEnd: false })]);
  assert.equal(row.canEnd, false);
});

test("sorted by port in either direction, the same port by PID", () => {
  const rows = group([sock(8080, "0.0.0.0", 5), sock(135, "0.0.0.0", 9), sock(3000, "::1", 8), sock(3000, "::1", 2), sock(49664, "0.0.0.0", 1)]);
  assert.deepEqual(byPort(rows, "asc").map((r) => [r.port, r.pid]), [[135, 9], [3000, 2], [3000, 8], [8080, 5], [49664, 1]]);
  assert.deepEqual(byPort(rows, "desc").map((r) => [r.port, r.pid]), [[49664, 1], [8080, 5], [3000, 2], [3000, 8], [135, 9]]);
  assert.equal(byPort(rows, "asc")[0].port, 135, "the input is not reordered");
  assert.equal(rows[0].port, 8080);
});

test("an ended row stays listed with its result until the system drops it", () => {
  const [kept, gone] = group([sock(3000, "::1", 7), sock(5173, "::1", 8)]);
  const outcomes: Record<string, Outcome> = { [gone.key]: { row: gone, outcome: "ended" }, [kept.key]: { row: kept, outcome: "denied" } };
  // Still listed: not shown twice. Missing from the list: put back.
  assert.deepEqual(withEnded([kept], outcomes).map((r) => r.key), [kept.key, gone.key]);
  assert.deepEqual(withEnded([kept, gone], outcomes).map((r) => r.key), [kept.key, gone.key]);
  assert.deepEqual(withEnded([kept], {}).map((r) => r.key), [kept.key]);
});
