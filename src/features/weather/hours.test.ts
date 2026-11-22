import { test } from "node:test";
import assert from "node:assert/strict";
import { hourStart, nextHours, sunNow } from "./hours.ts";

test("an hour in a place's clock time is placed with the place's UTC offset", () => {
  // 09:00 in New York (UTC-5) is 14:00 UTC.
  assert.equal(hourStart("2026-11-04T09:00", -5 * 3600), Date.UTC(2026, 10, 4, 14));
  assert.equal(hourStart("2026-11-04T15:00", 0), Date.UTC(2026, 10, 4, 15));
  // Vienna, UTC+1.
  assert.equal(hourStart("2026-11-04T15:00", 3600), Date.UTC(2026, 10, 4, 14));
  // Without an offset: the PC's zone.
  assert.equal(hourStart("2026-11-04T15:00"), new Date(2026, 10, 4, 15).getTime());
});

test("the next hours start after now, however old the saved forecast is", () => {
  const hourly = ["14:00", "15:00", "16:00", "17:00", "18:00"].map((h) => ({ time: `2026-11-21T${h}` }));
  // Offset 0: the times are UTC wall times, so 15:10 UTC is past 15:00.
  assert.deepEqual(nextHours(hourly, 0, Date.parse("2026-11-21T15:10Z")).map((h) => h.time.slice(11)), ["16:00", "17:00", "18:00"]);
  assert.deepEqual(nextHours(hourly, 3600, Date.parse("2026-11-21T13:30Z")).map((h) => h.time.slice(11)), ["15:00", "16:00", "17:00"]);
  assert.deepEqual(nextHours(undefined, 0, 0), []);
  assert.deepEqual(nextHours(hourly, 0, Date.parse("2026-11-22T00:00Z")), []);
});

const day = { sunrise: "2026-11-04T07:12", sunset: "2026-11-04T16:40" };
const next = { sunrise: "2026-11-05T07:14", sunset: "2026-11-05T16:39" };
const at = (time: string) => Date.parse(`2026-11-04T${time}Z`);

test("the sun's share of the daylight runs from 0 at sunrise to 1 at sunset, and is null before it rises", () => {
  // Offset 0: the times are UTC wall times.
  assert.deepEqual(sunNow([day, next], 0, at("06:00")), { rise: day.sunrise, set: day.sunset, share: null });
  assert.deepEqual(sunNow([day, next], 0, at("07:12")), { rise: day.sunrise, set: day.sunset, share: 0 });
  // 4 h 44 of the day's 9 h 28.
  assert.deepEqual(sunNow([day, next], 0, at("11:56")), { rise: day.sunrise, set: day.sunset, share: 0.5 });
});

test("after sunset the sun waits for the next day's sunrise", () => {
  assert.deepEqual(sunNow([day, next], 0, at("16:40")), { rise: next.sunrise, set: next.sunset, share: null });
  assert.deepEqual(sunNow([day, next], 0, at("20:00")), { rise: next.sunrise, set: next.sunset, share: null });
});

test("the sun's times are read in the place's UTC offset, or in the PC's zone without one", () => {
  // Vienna, UTC+1: 11:56 there is 10:56 UTC.
  assert.equal(sunNow([day, next], 3600, at("10:56"))?.share, 0.5);
  assert.equal(sunNow([day, next], undefined, new Date(2026, 10, 4, 11, 56).getTime())?.share, 0.5);
});

test("a day without a sunrise and a sunset, or with the same instant for both (polar night), is skipped", () => {
  const polar = { sunrise: "2026-11-04T00:00", sunset: "2026-11-04T00:00" };
  assert.deepEqual(sunNow([polar, next], 0, at("12:00")), { rise: next.sunrise, set: next.sunset, share: null });
  assert.deepEqual(sunNow([{}, next], 0, at("12:00"))?.rise, next.sunrise);
  assert.equal(sunNow([polar, {}], 0, at("12:00")), null);
  assert.equal(sunNow([], 0, at("12:00")), null);
  // After the last sunset the forecast knows no more.
  assert.equal(sunNow([day, next], 0, Date.parse("2026-11-05T17:00Z")), null);
});

test("midnight sun has no face, and a sunrise past tomorrow is not shown as the next one", () => {
  // Open-Meteo's midnight sun: 00:00 to the next day's 00:00.
  assert.equal(sunNow([{ sunrise: "2026-11-23T00:00", sunset: "2026-11-24T00:00" }, next], 0, Date.parse("2026-11-23T12:00Z")), null);
  const polar = { sunrise: "2026-11-04T00:00", sunset: "2026-11-04T00:00" };
  assert.equal(sunNow([polar, polar, next], 0, at("12:00")), null);
});
