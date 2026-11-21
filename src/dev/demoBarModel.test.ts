import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_APPS, launchApp, seedWindows, windowAction } from "./demoBarModel.ts";

const ids = (list: ReturnType<typeof seedWindows>) => list.groups.flatMap((g) => g.windows.map((w) => w.id));
const win = (list: ReturnType<typeof seedWindows>, id: number) => list.groups.flatMap((g) => g.windows).find((w) => w.id === id);

test("the demo's desktop starts with every app's windows and one of them in front", () => {
  const list = seedWindows();
  assert.equal(new Set(ids(list)).size, ids(list).length);
  assert.ok(list.groups.every((g) => g.windows.length > 0));
  assert.ok(list.active !== null && ids(list).includes(list.active));
  assert.equal(list.groups.length, DEMO_APPS.filter((a) => a.windows.length).length);
});

test("starting a pinned app with no window opens one in front", () => {
  const calc = DEMO_APPS.find((a) => !a.windows.length)!;
  const before = seedWindows();
  const after = launchApp(before, calc);
  const group = after.groups.find((g) => g.key === calc.id)!;
  assert.equal(group.windows.length, 1);
  assert.equal(group.windows[0].title, calc.name);
  assert.equal(after.active, group.windows[0].id);
  assert.equal(new Set(ids(after)).size, ids(after).length);
  assert.deepEqual(group.pins, [{ id: calc.id, name: calc.name }]);
});

test("a click on the window in front minimizes it, a second brings it back", () => {
  const list = seedWindows();
  const front = list.active!;
  const down = windowAction(list, front, "toggle");
  assert.equal(win(down, front)!.minimized, true);
  assert.equal(down.active, null);
  const up = windowAction(down, front, "toggle");
  assert.equal(win(up, front)!.minimized, false);
  assert.equal(up.active, front);
});

test("a click on a window behind brings it forward", () => {
  const list = seedWindows();
  const behind = ids(list).find((id) => id !== list.active)!;
  const next = windowAction(list, behind, "toggle");
  assert.equal(next.active, behind);
  assert.equal(win(next, behind)!.minimized, false);
});

test("closing a window removes it, and an app with none left leaves the list", () => {
  const list = seedWindows();
  const many = list.groups.find((g) => g.windows.length > 1)!;
  const one = list.groups.find((g) => g.windows.length === 1)!;
  const fewer = windowAction(list, many.windows[0].id, "close");
  assert.equal(fewer.groups.find((g) => g.key === many.key)!.windows.length, many.windows.length - 1);
  const gone = windowAction(list, one.windows[0].id, "close");
  assert.equal(gone.groups.some((g) => g.key === one.key), false);
  assert.equal(gone.active === one.windows[0].id, false);
});
