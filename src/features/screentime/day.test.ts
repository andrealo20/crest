import { test } from "node:test";
import assert from "node:assert/strict";

// Rome: the clocks go forward on 29 March 2026 and back on 25 October.
process.env.TZ = "Europe/Rome";
const { blocks, dayEvents, eventSpans, stripWindow, sunSpans, ticks } = await import("./day.ts");

const H = 3_600_000;

test("the whole day runs from its midnight to the next, 23 or 25 hours on the days the clocks change", () => {
  const at = new Date(2026, 10, 23, 14, 30).getTime();
  assert.deepEqual(stripWindow("fullday", at), [new Date(2026, 10, 23).getTime(), new Date(2026, 10, 24).getTime()]);
  const [a, b] = stripWindow("fullday", new Date(2026, 2, 29, 12).getTime());
  assert.equal(b - a, 23 * H);
  const [c, d] = stripWindow("fullday", new Date(2026, 9, 25, 12).getTime());
  assert.equal(d - c, 25 * H);
});

test("the next hours run from two hours ago to six ahead, to the minute, across midnight", () => {
  const at = new Date(2026, 10, 23, 23, 0, 40).getTime();
  assert.deepEqual(stripWindow("ahead", at), [new Date(2026, 10, 23, 21).getTime(), new Date(2026, 10, 24, 5).getTime()]);
});

test("a block is cut at the window's edges and at least 2 px wide", () => {
  const from = 0, to = 100;
  assert.deepEqual(blocks([[-50, 50]], from, to, 200), [{ x: 0, w: 100 }]);
  assert.deepEqual(blocks([[90, 150]], from, to, 200), [{ x: 180, w: 20 }]);
  assert.deepEqual(blocks([[10, 10.1]], from, to, 200), [{ x: 20, w: 2 }]);
  // A short one at the end stays inside.
  assert.deepEqual(blocks([[99.9, 100]], from, to, 200), [{ x: 198, w: 2 }]);
  assert.deepEqual(blocks([[100, 120], [-20, 0]], from, to, 200), []);
});

test("daylight: nothing without a place, one span a day the window touches with one", () => {
  const [from, to] = stripWindow("fullday", new Date(2026, 5, 21, 12).getTime());
  assert.deepEqual(sunSpans(from, to, null), []);
  const rome = { lat: 41.9, lon: 12.5 };
  const one = sunSpans(from, to, rome);
  assert.equal(one.length, 1);
  const [rise, set] = one[0];
  // Midsummer in Rome: the sun rises before 6 and sets after 20:30.
  assert.ok(new Date(rise).getHours() === 5 && new Date(set).getHours() === 20, `${new Date(rise)} ${new Date(set)}`);
  // The next hours late in the evening touch two days.
  const [a, b] = stripWindow("ahead", new Date(2026, 5, 21, 23).getTime());
  assert.equal(sunSpans(a, b, rome).length, 2);
});

test("only the timed events that touch the window", () => {
  const ev = (start: number, end: number, allDay = false) => ({ start, end, allDay, color: "red" });
  const list = [ev(10, 20), ev(0, 1000, true), ev(150, 160), ev(-10, 5), ev(50, 50)];
  assert.deepEqual(eventSpans(list, 0, 100), [ev(10, 20), ev(-10, 5), ev(50, 50)]);
  // With their calendar's colour and nothing else; the link's blue for a calendar without one.
  const data = { calendars: [{ id: "w", color: "#123" }], events: [{ id: "1", calendar: "w", title: "Standup", start: 10, end: 20, allDay: false }, { id: "2", calendar: "x", title: "Lunch", start: 30, end: 40, allDay: false }] };
  assert.deepEqual(dayEvents(data, 0, 100), [{ start: 10, end: 20, color: "#123" }, { start: 30, end: 40, color: "var(--color-link)" }]);
  assert.deepEqual(dayEvents(null, 0, 100), []);
});

test("the ticks: 6, 12 and 18 on the whole day, every whole hour inside the next hours", () => {
  const [from, to] = stripWindow("fullday", new Date(2026, 10, 23, 9).getTime());
  assert.deepEqual(ticks("fullday", from, to).map((t) => new Date(t).getHours()), [6, 12, 18]);
  const [a, b] = stripWindow("ahead", new Date(2026, 10, 23, 9, 30).getTime());
  assert.deepEqual(ticks("ahead", a, b).map((t) => new Date(t).getHours()), [8, 9, 10, 11, 12, 13, 14, 15]);
});
