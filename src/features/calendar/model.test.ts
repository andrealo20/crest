import { test } from "node:test";
import assert from "node:assert/strict";
import { CALENDAR_DEFAULTS, PALETTE, agenda, dayLabel, dueEvent, linkHost, newSourceId, nextChange, nextColor, monthGrid, nextEvent, normalizeCalendar } from "./model.ts";

const at = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m).getTime(); // November 2026
const ev = (id: string, start: number, end: number, allDay = false) => ({ id, start, end, allDay });
const MIN = 60_000;

test("saved settings are repaired", () => {
  assert.deepEqual(normalizeCalendar(undefined), CALENDAR_DEFAULTS);
  const n = normalizeCalendar({
    sources: [
      { id: "abc1", kind: "ics", name: "Work", color: "#112233", host: "calendar.google.com" },
      { id: "abc1", kind: "ics" }, // duplicate id
      { id: "Bad.Id", kind: "ics" },
      { id: "x2", kind: "exchange" },
      { id: "dav1", kind: "caldav", url: "https://caldav.icloud.com", user: "me", color: "red" },
    ],
    notice: false,
    noticeMin: 7,
    horizonMin: 999,
  });
  assert.deepEqual(n.sources.map((s) => s.id), ["abc1", "dav1"]);
  assert.equal(n.sources[0].color, "#112233");
  assert.match(n.sources[1].color, /^#[0-9a-f]{6}$/);
  assert.equal(n.sources[1].url, "https://caldav.icloud.com");
  assert.equal(n.notice, false);
  assert.equal(n.noticeMin, 10);
  assert.equal(n.horizonMin, 60);
});

test("source ids, colours and link hosts", () => {
  let i = 0;
  const seq = [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  const id = newSourceId(["aaaaaaaa"], () => seq[i++]);
  assert.equal(id, "ssssssss");
  assert.match(newSourceId([]), /^[a-z0-9]{8}$/);
  assert.equal(nextColor([{ color: PALETTE[0] }]), PALETTE[1]);
  assert.equal(linkHost("webcal://p52-caldav.icloud.com/published/2/x"), "p52-caldav.icloud.com");
  assert.equal(linkHost("https://outlook.office365.com/owa/calendar/a/b/calendar.ics"), "outlook.office365.com");
  assert.equal(linkHost("not a link"), "");
});

test("agenda: days from today, all-day first, multi-day on each day", () => {
  const events = [
    ev("late", at(1, 18), at(1, 19)),
    ev("early", at(1, 9), at(1, 10)),
    ev("trip", at(1), at(3), true),
    ev("tomorrow", at(2, 8), at(2, 8, 30)),
    ev("night", at(2, 23), at(3, 1)),
    ev("reminder", at(3, 12), at(3, 12)),
    ev("yesterday", at(0, 9), at(0, 10)),
  ];
  const days = agenda(events, at(1, 12), 3);
  assert.deepEqual(days.map((d) => d.day), [at(1), at(2), at(3)]);
  assert.deepEqual(days[0].events.map((e) => e.id), ["trip", "early", "late"]);
  assert.deepEqual(days[1].events.map((e) => e.id), ["trip", "tomorrow", "night"]);
  assert.deepEqual(days[2].events.map((e) => e.id), ["night", "reminder"]);
});

test("agenda days follow local midnight across a DST change", () => {
  // 25 Oct 2026 is the European change; the days stay at local midnight.
  const days = agenda([], new Date(2026, 9, 24, 12).getTime(), 3);
  assert.deepEqual(days.map((d) => new Date(d.day).getHours()), [0, 0, 0]);
  assert.deepEqual(days.map((d) => new Date(d.day).getDate()), [24, 25, 26]);
});

test("next event skips all-day and started ones", () => {
  const events = [ev("allday", at(1), at(2), true), ev("now", at(1, 9), at(1, 10)), ev("b", at(1, 15), at(1, 16)), ev("a", at(1, 11), at(1, 12))];
  assert.equal(nextEvent(events, at(1, 9, 30))?.id, "a");
  assert.equal(nextEvent(events, at(1, 16)), null);
});

test("notice: inside the lead, not dismissed, gone at the start", () => {
  const events = [ev("a", at(1, 10), at(1, 11)), ev("b", at(1, 10, 5), at(1, 11))];
  assert.equal(dueEvent(events, at(1, 9, 49), 10, new Set()), null);
  assert.equal(dueEvent(events, at(1, 9, 50), 10, new Set())?.id, "a");
  assert.equal(dueEvent(events, at(1, 9, 56), 10, new Set(["a"]))?.id, "b");
  assert.equal(dueEvent(events, at(1, 9, 56), 5, new Set(["a"])), null);
  assert.equal(dueEvent(events, at(1, 10), 10, new Set())?.id, "b");
  assert.equal(dueEvent(events, at(1, 10, 5), 10, new Set()), null);
});

test("next change: the earliest start or lead ahead", () => {
  const events = [ev("a", at(1, 10), at(1, 11)), ev("d", at(1), at(2), true)];
  assert.equal(nextChange(events, at(1, 8), [10 * MIN, 60 * MIN]), at(1, 9));
  assert.equal(nextChange(events, at(1, 9, 30), [10 * MIN, 60 * MIN]), at(1, 9, 50));
  assert.equal(nextChange(events, at(1, 9, 55), [10 * MIN]), at(1, 10));
  assert.equal(nextChange(events, at(1, 10), [10 * MIN]), null);
});

test("day labels", () => {
  const labels = { today: "Today", tomorrow: "Tomorrow" };
  const fmt = (d: Date) => `${d.getDate()}.`;
  assert.equal(dayLabel(at(1), at(1, 15), labels, fmt), "Today");
  assert.equal(dayLabel(at(2), at(1, 15), labels, fmt), "Tomorrow");
  assert.equal(dayLabel(at(5), at(1, 15), labels, fmt), "5.");
});

test("month grid: six weeks from the first weekday, calendars per day", () => {
  const on = (id: string, calendar: string, start: number, end: number, allDay = false) => ({ ...ev(id, start, end, allDay), calendar });
  const events = [on("call", "work", at(3, 10), at(3, 11)), on("gym", "home", at(3), at(4), true), on("trip", "work", at(5), at(7), true), on("again", "work", at(3, 15), at(3, 16))];
  // 1 November 2026 is a Sunday: a Monday week starts on 26 October, a Sunday week on the 1st.
  const monday = monthGrid(events, at(15, 12), 1);
  assert.equal(monday.length, 42);
  assert.equal(monday[0].day, new Date(2026, 9, 26).getTime());
  assert.equal(monday[0].inMonth, false);
  assert.equal(monday[6].day, at(1));
  assert.equal(monday[6].inMonth, true);
  assert.equal(monday[41].day, new Date(2026, 11, 6).getTime());
  assert.equal(monthGrid(events, at(1), 0)[0].day, at(1));
  const cell = (d: number) => monday.find((c) => c.day === at(d))!;
  assert.deepEqual(cell(3).calendars, ["work", "home"]);
  assert.deepEqual(cell(5).calendars, ["work"]);
  assert.deepEqual(cell(6).calendars, ["work"]);
  assert.deepEqual(cell(7).calendars, []);
});
