import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_LINE, MAX_LINES, evaluate, type LineResult, type Options, type Value } from "./engine.ts";
import { formatValue } from "./format.ts";

// A Friday at noon, local time: the engine reads the clock only through this.
const NOW = new Date(2026, 10, 6, 12, 0, 0);
const RATES: Record<string, number> = { EUR: 1, USD: 1.25, GBP: 0.8, JPY: 160 };
const money: Options["money"] = (amount, from, to) => (RATES[from] && RATES[to] ? (amount / RATES[from]) * RATES[to] : null);

const text = (r: LineResult): string => (r.kind === "value" ? formatValue(r.value, "en-US") : r.kind === "error" ? `!${r.code}` : "");
/** Every line of `src` as the sheet would show it: the result, "!code" for an error, "" for nothing. */
const sheet = (src: string, opts: Options = { now: NOW, money }): string[] => evaluate(src, opts).lines.map(text);
/** The result of one line. */
const one = (line: string, opts?: Options): string => sheet(line, opts)[0];
const value = (line: string): Value => {
  const r = evaluate(line, { now: NOW, money }).lines[0];
  assert.equal(r.kind, "value", `${line} -> ${text(r)}`);
  return (r as Extract<LineResult, { kind: "value" }>).value;
};
const number = (line: string): number => {
  const v = value(line);
  assert.ok(v.k === "num" || v.k === "qty" || v.k === "pct" || v.k === "money", line);
  return v.v;
};
const date = (line: string): Date => {
  const v = value(line);
  assert.equal(v.k, "date", line);
  return new Date((v as Extract<Value, { k: "date" }>).t);
};
const ymd = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];

function table(rows: [string, string][]) {
  for (const [line, want] of rows) assert.equal(one(line), want, line);
}

test("arithmetic and precedence", () => {
  table([
    ["1+2*3", "7"],
    ["(1+2)*3", "9"],
    ["10 - 4 - 3", "3"],
    ["100 / 5 / 2", "10"],
    ["2^3^2", "512"],
    ["-2^2", "-4"],
    ["(-2)^2", "4"],
    ["2^-1", "0.5"],
    ["2 ** 10", "1,024"],
    ["-(-3)", "3"],
    ["--3", "3"],
    ["+5", "5"],
    ["3 * -2", "-6"],
    ["10 % 3", "1"],
    ["10 mod 3", "1"],
    ["-7 % 3", "-1"],
    ["7.5 % 2", "1.5"],
    ["2 * 3 + 4 * 5", "26"],
    ["2 + 3 * 4 ^ 2 / 8", "8"],
    ["0.1 + 0.2", "0.3"],
    ["1 / 3", "0.333333"],
    ["1000 / 3", "333.33333"],
    ["10000 / 3", "3,333.3333"],
    ["1000000 / 3", "333,333.33"],
    ["22 / 7", "3.142857"],
    ["5 plus 3 times 2", "11"],
    ["10 minus 4", "6"],
    ["5 divided by 2", "2.5"],
    ["3 × 4", "12"],
    ["8 ÷ 2", "4"],
    ["9 − 4", "5"],
    ["  2   +   2  ", "4"],
    ["2 + 2 =", "4"],
    ["what is 2 + 2?", "4"],
    ["2*(3+(4-1))", "12"],
  ]);
});

test("numbers with separators and scientific notation", () => {
  table([
    ["1,000", "1,000"],
    ["1,000.50 + 1", "1,001.5"],
    ["12,345,678 + 1", "12,345,679"],
    ["1.234,5 + 1", "1,235.5"],
    ["1.000.000 + 1", "1,000,001"],
    ["1 000 + 1", "1,001"],
    ["2 500 000", "2,500,000"],
    ["1_000_000", "1,000,000"],
    ["1,5 + 1", "2.5"],
    ["1,25 * 2", "2.5"],
    ["0,125 + 1", "1.125"],
    ["0,5 * 3", "1.5"],
    [".5 + .25", "0.75"],
    ["1e3", "1,000"],
    ["1E3", "1,000"],
    ["1.5e-3", "0.0015"],
    ["2e+2", "200"],
    ["6.02e23", "6.02E23"],
    ["1e-9", "1E-9"],
    ["123456789012345", "123,456,789,012,345"],
    ["1e15", "1E15"],
    ["0.0000001", "0.0000001"],
    ["1234567.891234", "1,234,567.89"],
    ["3.14159265358979", "3.141593"],
    ["0.000123456789", "0.000123457"],
  ]);
});

test("a comma inside a function call separates arguments", () => {
  table([
    ["max(1,200)", "200"],
    ["max(1, 200)", "200"],
    ["min(1,000)", "0"],
    ["pow(2,10)", "1,024"],
    ["max(1,200) + 1,000", "1,200"],
  ]);
});

test("percentages", () => {
  table([
    ["20% of 80", "16"],
    ["20 % of 80", "16"],
    ["what is 15% of 60", "9"],
    ["what's 15% of 60?", "9"],
    ["whats 15% of 60", "9"],
    ["100 + 15%", "115"],
    ["100 - 15%", "85"],
    ["200 + 10% + 10%", "242"],
    ["50%", "50%"],
    ["12.5%", "12.5%"],
    ["10% + 5%", "15%"],
    ["50% - 20%", "30%"],
    ["20% * 80", "16"],
    ["80 * 20%", "16"],
    ["100 / 20%", "500"],
    ["20% / 2", "10%"],
    ["20% of 5 km", "1 km"],
    ["15% of 200 + 5", "35"],
    ["100 + 15% of 200", "130"],
    ["10 % 3", "1"],
    ["(2+3)%", "5%"],
    ["100 km + 10%", "110 km"],
    ["3 of 5", "!of"],
    ["5 km %", "!pctPos"],
    ["10% + 5", "!combine"],
  ]);
});

test("variables, ans and the line above", () => {
  assert.deepEqual(sheet("price = 12.5\nprice * 3\nans + 1\nabove * 2"), ["12.5", "37.5", "38.5", "77"]);
  assert.deepEqual(sheet("a = 2\nb = a * 3\na = 10\nb + a"), ["2", "6", "10", "16"]);
  assert.deepEqual(sheet("Price = 4\nprice * 2\nPRICE + 1"), ["4", "8", "5"]);
  // ans is the last line that worked; above is the line directly above, and only that.
  assert.deepEqual(sheet("5\nfoo\nans * 2"), ["5", "!name", "10"]);
  assert.deepEqual(sheet("5\nfoo\nabove * 2"), ["5", "!name", "!noAbove"]);
  assert.deepEqual(sheet("5\n\nabove"), ["5", "", "!noAbove"]);
  assert.deepEqual(sheet("ans"), ["!noAns"]);
  assert.deepEqual(sheet("above"), ["!noAbove"]);
  // A variable is only known below its definition, and a failed line defines nothing.
  assert.deepEqual(sheet("x + 1\nx = 1\nx + 1"), ["!name", "1", "2"]);
  assert.deepEqual(sheet("total = 1 / 0\ntotal"), ["!div0", "!name"]);
  assert.deepEqual(sheet("tax = 20%\n100 + tax\ntax * 50"), ["20%", "120", "10"]);
  assert.deepEqual(sheet("d = 5 km\nd in mi\nd * 2"), ["5 km", "3.106856 mi", "10 km"]);
  // Names that are units still work as variables, and the unit wins right after a number.
  assert.deepEqual(sheet("m = 3\nm * 2\n4 m"), ["3", "6", "4 m"]);
  assert.deepEqual(sheet("pi = 3"), ["!reserved"]);
  assert.deepEqual(sheet("sqrt = 3"), ["!reserved"]);
  assert.deepEqual(sheet("ans = 3"), ["!reserved"]);
  assert.deepEqual(sheet("x = y = 3"), ["!needNumber"]);
  assert.deepEqual(sheet("x ="), ["!incomplete"]);
  assert.deepEqual(sheet("constructor"), ["!name"]);
  assert.deepEqual(sheet("__proto__ = 1\n__proto__"), ["1", "1"]);
  assert.deepEqual(sheet("toString + 1"), ["!name"]);
});

test("functions", () => {
  table([
    ["sqrt(16)", "4"],
    ["sqrt(2)", "1.414214"],
    ["abs(-3)", "3"],
    ["abs(-3 km)", "3 km"],
    ["round(2.5)", "3"],
    ["round(-2.5)", "-3"],
    ["round(3.14159, 2)", "3.14"],
    ["round(1.005, 2)", "1.01"],
    ["round(1234.5678, 0)", "1,235"],
    ["round(2.5 km)", "3 km"],
    ["floor(2.7)", "2"],
    ["floor(-2.1)", "-3"],
    ["ceil(2.1)", "3"],
    ["ceil(-2.9)", "-2"],
    ["min(3, 1, 2)", "1"],
    ["max(3, 1, 2)", "3"],
    ["max(1 km, 500 m)", "1 km"],
    ["min(1 km, 500 m)", "500 m"],
    ["max(5)", "5"],
    ["log(1000)", "3"],
    ["log(100)", "2"],
    ["ln(e)", "1"],
    ["ln(1)", "0"],
    ["pow(2, 10)", "1,024"],
    ["pow(2, 0.5)", "1.414214"],
    ["sqrt(abs(-16)) + max(1, 2)", "6"],
    ["SQRT(9)", "3"],
    ["sqrt(-1)", "!domain"],
    ["log(0)", "!domain"],
    ["log(-5)", "!domain"],
    ["ln(0)", "!domain"],
    ["sqrt()", "!argCount"],
    ["sqrt(1, 2)", "!argCount"],
    ["min()", "!argCount"],
    ["pow(2)", "!argCount"],
    ["round(1, 2, 3)", "!argCount"],
    ["round(1.5, 2.5)", "!domain"],
    ["round(1.5, 16)", "!domain"],
    ["round(1.5, -1)", "!domain"],
    ["sqrt 4", "!needParen"],
    ["sqrt(4", "!paren"],
    ["sqrt(4))", "!paren"],
    ["sqrt(4 km)", "!plain"],
    ["max(1 km, 1 kg)", "!combine"],
    ["max(1, 1 km)", "!combine"],
    ["pow(0, -1)", "!div0"],
    ["pow(-8, 0.5)", "!range"],
  ]);
});

test("constants", () => {
  assert.ok(Math.abs(number("pi") - Math.PI) < 1e-12);
  assert.ok(Math.abs(number("π") - Math.PI) < 1e-12);
  assert.ok(Math.abs(number("e") - Math.E) < 1e-12);
  assert.ok(Math.abs(number("2 * pi") - 2 * Math.PI) < 1e-12);
  assert.equal(one("pi"), "3.141593");
  assert.equal(one("e"), "2.718282");
  assert.equal(one("2 pi"), "!unexpected");
});

test("trigonometry needs a declared angle", () => {
  assert.ok(Math.abs(number("sin(30 deg)") - 0.5) < 1e-12);
  assert.ok(Math.abs(number("cos(60 degrees)") - 0.5) < 1e-12);
  assert.ok(Math.abs(number("tan(45 deg)") - 1) < 1e-12);
  assert.ok(Math.abs(number("sin((pi/2) rad)") - 1) < 1e-12);
  table([
    ["sin(30 deg)", "0.5"],
    ["sin(90 deg)", "1"],
    ["cos(0 deg)", "1"],
    ["cos(90 deg)", "0"],
    ["cos(180 deg)", "-1"],
    ["sin(180 deg)", "0"],
    ["sin(pi rad)", "0"],
    ["cos(pi rad)", "-1"],
    ["sin(0.5 rad)", "0.479426"],
    ["tan(45 deg)", "1"],
    ["sin(1 rad + 30 deg)", "0.998886"],
    ["sin(°)", "!needNumber"],
    ["sin(30°)", "0.5"],
    ["asin(0.5) in deg", "30°"],
    ["acos(1) in deg", "0°"],
    ["atan(1) in deg", "45°"],
    ["asin(2)", "!domain"],
    ["acos(-2)", "!domain"],
    ["tan(90 deg)", "!domain"],
    ["sin(1)", "!angle"],
    ["sin(pi)", "!angle"],
    ["cos(1 km)", "!angle"],
    ["pi rad in deg", "180°"],
    ["sin(pi/2 rad)", "!unitDiv"],
    ["180 deg in rad", "3.141593 rad"],
  ]);
});

test("unit conversion", () => {
  table([
    ["5 km in miles", "3.106856 mi"],
    ["5 km to mi", "3.106856 mi"],
    ["5 km as miles", "3.106856 mi"],
    ["5 km into m", "5,000 m"],
    ["5km in m", "5,000 m"],
    ["72 F in C", "22.222222°C"],
    ["72 °F in °C", "22.222222°C"],
    ["72°F to C", "22.222222°C"],
    ["100 C in F", "212°F"],
    ["0 C in K", "273.15 K"],
    ["0 K in C", "-273.15°C"],
    ["0 K to celsius", "-273.15°C"],
    ["0 k in C", "!unexpected"],
    ["300 K in C", "26.85°C"],
    ["-40 C in F", "-40°F"],
    ["3 hours in minutes", "180 min"],
    ["90 minutes in hours", "1.5 h"],
    ["2 days in hours", "48 h"],
    ["1 week in days", "7 d"],
    ["1 year in days", "365.25 d"],
    ["1500 ms in s", "1.5 s"],
    ["2 kg to lb", "4.409245 lb"],
    ["1 lb in oz", "16 oz"],
    ["500 g in kg", "0.5 kg"],
    ["1 t in kg", "1,000 kg"],
    ["12 in in cm", "30.48 cm"],
    ["12 inch in cm", "30.48 cm"],
    ["12 in", "12 in"],
    ["1 mile in km", "1.609344 km"],
    ["1 ft in cm", "30.48 cm"],
    ["1 yd in ft", "3 ft"],
    ["1 gal in l", "3.785412 l"],
    ["1 cup in ml", "236.58824 ml"],
    ["3 tsp in ml", "14.786765 ml"],
    ["60 km/h in m/s", "16.666667 m/s"],
    ["10 m/s in km/h", "36 km/h"],
    ["60 mph in kmh", "96.56064 km/h"],
    ["10 knots in km/h", "18.52 km/h"],
    ["2 m3 in l", "2,000 l"],
    ["180 deg in rad", "3.141593 rad"],
    ["1 rad in deg", "57.29578°"],
    ["5 KM IN MILES", "3.106856 mi"],
    ["5 Km In Miles", "3.106856 mi"],
    ["5 km in kg", "!mismatch"],
    ["5 km in EUR", "!mismatch"],
    ["5 kg in hours", "!mismatch"],
    ["5 in cm", "!noUnit"],
    ["5 in", "5 in"],
    ["5 km in", "!incomplete"],
    ["5 km in 3", "!unit"],
    ["5 km in banana", "!unit"],
    ["5 banana", "!unexpected"],
    ["5 k", "!unexpected"],
    ["km", "!needNumber"],
    ["km in m", "!needNumber"],
    ["15% in km", "!noConvert"],
    ["today in days", "!noConvert"],
  ]);
});

test("units in sums, products and quotients", () => {
  table([
    ["2 km + 500 m", "2.5 km"],
    ["500 m + 2 km", "2,500 m"],
    ["2 km - 500 m", "1.5 km"],
    ["1 h + 30 min", "1.5 h"],
    ["1 h + 30 min in min", "90 min"],
    ["2 km + 500 m in feet", "8,202.0997 ft"],
    ["5 m in cm + 3 m", "800 cm"],
    ["3 km * 2", "6 km"],
    ["2 * 3 km", "6 km"],
    ["3 km / 2", "1.5 km"],
    ["10 km / 2 km", "5"],
    ["10 km / 500 m", "20"],
    ["1 h / 30 min", "2"],
    ["-5 km", "-5 km"],
    ["-(5 km)", "-5 km"],
    ["(1 + 2) km", "3 km"],
    ["2 * (1 + 2) kg", "6 kg"],
    ["5 km + 3", "!combine"],
    ["3 + 5 km", "!combine"],
    ["5 km + 3 kg", "!combine"],
    ["5 km * 3 m", "!twoUnits"],
    ["5 / 2 km", "!unitDiv"],
    ["5 km / 2 kg", "!combine"],
    ["5 km ^ 2", "!plain"],
    ["5 km % 3", "!plain"],
    ["5 km 3", "!unexpected"],
  ]);
});

test("temperatures are never added to each other", () => {
  table([
    ["10 C + 5 C", "!temp"],
    ["10 C - 5 C", "!temp"],
    ["20 C + 5", "!combine"],
    ["20 C * 2", "40°C"],
    ["20 C / 2", "10°C"],
    ["20 C / 10 C", "!combine"],
    ["max(20 C, 70 F)", "70°F"],
    ["min(20 C, 70 F)", "20°C"],
  ]);
});

test("dates follow the injected clock", () => {
  assert.deepEqual(ymd(date("today")), [2026, 11, 6]);
  assert.deepEqual(ymd(date("tomorrow")), [2026, 11, 7]);
  assert.deepEqual(ymd(date("yesterday")), [2026, 11, 5]);
  assert.equal(date("today").getHours(), 0);
  assert.equal(date("now").getTime(), NOW.getTime());
  assert.deepEqual(ymd(date("today + 3 weeks")), [2026, 11, 27]);
  assert.deepEqual(ymd(date("3 weeks + today")), [2026, 11, 27]);
  assert.deepEqual(ymd(date("today - 1 week")), [2026, 10, 30]);
  assert.deepEqual(ymd(date("today + 2 days")), [2026, 11, 8]);
  assert.deepEqual(ymd(date("today + 30 days")), [2026, 12, 6]);
  assert.deepEqual(ymd(date("today + 60 days")), [2027, 1, 5]);
  assert.deepEqual(ymd(date("today + 1 month")), [2026, 12, 6]);
  assert.deepEqual(ymd(date("today + 3 months")), [2027, 2, 6]);
  assert.deepEqual(ymd(date("today + 1 year")), [2027, 11, 6]);
  assert.deepEqual(ymd(date("today - 1 year")), [2025, 11, 6]);
  assert.deepEqual(ymd(date("2026-01-31 + 1 month")), [2026, 2, 28]);
  assert.deepEqual(ymd(date("2024-02-29 + 1 year")), [2025, 2, 28]);
  assert.deepEqual(ymd(date("2024-02-28 + 1 day")), [2024, 2, 29]);
  assert.deepEqual(ymd(date("2026-12-31 + 1 day")), [2027, 1, 1]);
  assert.deepEqual(ymd(date("2026-12-25")), [2026, 12, 25]);
  assert.deepEqual(ymd(date("2026-12-25 - 25 days")), [2026, 11, 30]);
  // Hours and minutes move the clock and bring a time of day with them.
  const later = date("now + 90 minutes");
  assert.equal(later.getTime() - NOW.getTime(), 90 * 60_000);
  assert.equal(date("now - 2 hours").getTime() - NOW.getTime(), -2 * 3_600_000);
  assert.equal(date("today + 36 hours").getTime() - date("today").getTime(), 36 * 3_600_000);
  assert.equal((value("now + 90 minutes") as { time: boolean }).time, true);
  assert.equal((value("today + 3 weeks") as { time: boolean }).time, false);
  assert.equal((value("today + 1.5 days") as { time: boolean }).time, true);
  assert.equal(date("today + 1.5 days").getHours(), 12);
});

test("days until, since and the gap between dates", () => {
  table([
    ["days until 2026-12-25", "49 d"],
    ["weeks until 2026-12-25", "7 wk"],
    ["days until 2026-11-06", "0 d"],
    ["days until 2026-11-05", "-1 d"],
    ["days since 2026-11-01", "5 d"],
    ["days since 2026-01-01", "309 d"],
    ["days until tomorrow", "1 d"],
    ["days until today + 3 weeks", "21 d"],
    ["days until 2027-01-01", "56 d"],
    ["2026-12-25 - today", "49 d"],
    ["2026-12-25 - 2026-12-01", "24 d"],
    ["today - 2026-11-01", "5 d"],
    ["(2026-12-25 - today) in weeks", "7 wk"],
    ["hours until 2026-11-07", "12 h"],
    ["minutes until now + 90 minutes", "90 min"],
    ["days until now + 36 hours", "1.5 d"],
    ["days until 2026-02-30", "!date"],
    ["days until 2026-13-01", "!date"],
    ["days until 2026-00-10", "!date"],
    ["days until 5", "!span"],
    ["days until", "!incomplete"],
    ["km until 2026-12-25", "!needNumber"],
    ["today + 5", "!dateOp"],
    ["today + 5 km", "!dateOp"],
    ["3 + today", "!dateOp"],
    ["5 days - today", "!dateOp"],
    ["today + today", "!dateOp"],
    ["today * 2", "!dateOp"],
    ["today / 2", "!dateOp"],
    ["-today", "!dateOp"],
    ["today + 99999999999 years", "!range"],
    ["today + 1e300 days", "!range"],
  ]);
});

test("currencies use the rates it is given, and say so when there are none", () => {
  table([
    ["120 USD in EUR", "€96.00"],
    ["100 eur to usd", "$125.00"],
    ["120 GBP in EUR", "€150.00"],
    ["100 USD in GBP", "£64.00"],
    ["$50 + €20", "$75.00"],
    ["$50", "$50.00"],
    ["£100 in USD", "$156.25"],
    ["5 EUR + 5 USD", "€9.00"],
    ["10 EUR - 5 EUR", "€5.00"],
    ["10 EUR * 3", "€30.00"],
    ["3 * 10 EUR", "€30.00"],
    ["10 EUR / 4", "€2.50"],
    ["10 EUR / 5 EUR", "2"],
    ["10 USD / 8 EUR", "1"],
    ["15% of $200", "$30.00"],
    ["$200 + 10%", "$220.00"],
    ["120 GBP in EUR - 15%", "€127.50"],
    ["120 GBP in EUR - 15% + 5 EUR", "€132.50"],
    ["1 EUR in SEK", "!noRate"],
    ["1 SEK in EUR", "!noRate"],
    ["max(1 EUR, 1 USD)", "€1.00"],
    ["160 JPY in EUR", "€1.00"],
    ["5 EUR in km", "!mismatch"],
    ["5 EUR + 5 km", "!combine"],
    ["5 EUR * 5 EUR", "!twoUnits"],
    ["5 in EUR", "!noUnit"],
    ["EUR", "!needNumber"],
    ["1 XYZ in EUR", "!unexpected"],
  ]);
  const none: Options = { now: NOW };
  assert.equal(one("120 USD in EUR", none), "!rates");
  assert.equal(one("10 EUR + 5 EUR", none), "€15.00");
  assert.equal(one("10 EUR + 5 USD", none), "!rates");
  assert.equal(one("2 * 3", none), "6");
  assert.equal(evaluate("2 * 3", { now: NOW }).usesMoney, false);
  assert.equal(evaluate("5 km in m", { now: NOW }).usesMoney, false);
  assert.equal(evaluate("5 EUR", { now: NOW }).usesMoney, true);
  assert.equal(evaluate("$5", { now: NOW }).usesMoney, true);
  assert.equal(evaluate("2 * 3\n10 usd in eur", { now: NOW, money }).usesMoney, true);
});

test("comments, headings and blank lines", () => {
  assert.deepEqual(sheet("# note\n\n// another\n2 + 2 # four\n3 // three\nTrip budget:\nx = 2 # note"), ["", "", "", "4", "3", "", "2"]);
  assert.deepEqual(sheet("   \n\t\n"), ["", "", ""]);
  assert.deepEqual(sheet(""), [""]);
  assert.deepEqual(sheet("1\r\n2\r\n3"), ["1", "2", "3"]);
  assert.deepEqual(sheet("1\r2"), ["1", "2"]);
});

test("errors name their cause", () => {
  table([
    ["1 / 0", "!div0"],
    ["0 / 0", "!div0"],
    ["1 % 0", "!div0"],
    ["1 mod 0", "!div0"],
    ["5 km / 0", "!div0"],
    ["5 / 0 km", "!div0"],
    ["2 +", "!incomplete"],
    ["2 +* 3", "!unexpected"],
    ["*3", "!unexpected"],
    ["(2+3", "!paren"],
    ["2+3)", "!paren"],
    ["()", "!paren"],
    ["2 3", "!unexpected"],
    ["2 = 2", "!unexpected"],
    ["= 5", "!unexpected"],
    ["foo", "!name"],
    ["2 pi", "!unexpected"],
    ["2 @ 3", "!chars"],
    ["2 ; 3", "!chars"],
    ["\u{1f600}", "!chars"],
    ["1e400", "!bignum"],
    ["1e308 * 10", "!range"],
    ["10 ^ 400", "!range"],
    ["2 ^ 1e9", "!range"],
    ["(-8) ^ 0.5", "!range"],
    ["0 ^ -1", "!div0"],
    ["1e308 + 1e308", "!range"],
    ["of", "!name"],
    ["5 of 5", "!of"],
    ["until", "!name"],
    ["in", "!needNumber"],
    ["to", "!name"],
    ["$", "!incomplete"],
    ["$ + 1", "!unexpected"],
    ["$5 $5", "!unexpected"],
    ["5 %", "5%"],
  ]);
  // Never a number that is not a number.
  for (const line of ["1/0", "0/0", "1e999", "10^400", "sqrt(-1)", "log(0)", "(-8)^0.5", "1e308*10", "tan(90 deg)"]) {
    const first: { kind: string } = evaluate(line, { now: NOW, money }).lines[0];
    assert.equal(first.kind, "error", line);
  }
});

test("hostile input gets an error, not a hang or an exception", () => {
  const cases: [string, string][] = [
    ["a".repeat(MAX_LINE + 1), "!long"],
    ["1+".repeat(101), "!long"],
    ["(".repeat(99) + "1" + ")".repeat(99), "!depth"],
    ["-".repeat(150) + "1", "!depth"],
    ["2^".repeat(60) + "2", "!depth"],
    ["-(".repeat(60) + "1" + ")".repeat(60), "!depth"],
    ["+" .repeat(190) + "1", "!depth"],
    ["max(" + "1,".repeat(30) + "1)", "!argCount"],
    ["9".repeat(200), "1E200"],
    ["9".repeat(190) + "e150", "!bignum"],
    ["1" + "+1".repeat(99), "100"],
    ["(".repeat(30) + "1" + ")".repeat(30), "1"],
    ["-".repeat(30) + "1", "1"],
    ["2^2^2^2", "65,536"],
    ["2^2^2^2^2", "!range"],
    ["9^9^9", "!range"],
  ];
  for (const [line, want] of cases) assert.equal(one(line), want, line.slice(0, 30));
  assert.match(one("1".repeat(MAX_LINE)), /^1.11111/);
});

test("a long sheet stops at the line limit, quickly", () => {
  const rows = Array.from({ length: MAX_LINES + 20 }, (_, i) => `${i} + 1`);
  const t0 = Date.now();
  const lines = sheet(rows.join("\n"));
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(lines.length, MAX_LINES + 20);
  assert.equal(lines[0], "1");
  assert.equal(lines[MAX_LINES - 1], String(MAX_LINES));
  assert.equal(lines[MAX_LINES], "!tooMany");
  assert.deepEqual(sheet("1\n".repeat(MAX_LINES) + "\n\n").slice(-2), ["", ""]);
  const big = Array.from({ length: 3000 }, () => "x = 1 + 2 * (3 - 4) ^ 2 / 5 # note").join("\n");
  const t1 = Date.now();
  evaluate(big, { now: NOW, money });
  assert.ok(Date.now() - t1 < 2000);
});

test("random token soup never throws and never yields NaN or Infinity", () => {
  const words = [
    "1", "2", "0", "0.5", "1e5", "1e400", "-", "+", "*", "/", "^", "%", "(", ")", ",", "=", " ", "  ", "km", "m", "in", "to", "of", "ans", "above", "pi", "e", "x",
    "sqrt", "round", "min", "max", "sin", "log", "deg", "rad", "today", "now", "days", "until", "since", "EUR", "USD", "$", "€", "20%", "5 km", "2026-12-25",
    "°C", "F", "mod", "plus", "times", "what is", "?", "#", "\u0000", " ", "1,000", "1.5,5", "\u{1f600}", "x = ", "constructor", "__proto__", "0 ^ -1",
  ];
  let seed = 12345;
  const rnd = (n: number) => {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    return seed % n;
  };
  for (let round = 0; round < 3000; round++) {
    const parts: string[] = [];
    const n = 1 + rnd(14);
    for (let i = 0; i < n; i++) parts.push(words[rnd(words.length)]);
    const src = parts.join(rnd(3) === 0 ? "" : " ");
    let result: ReturnType<typeof evaluate>;
    try {
      result = evaluate(src + "\n" + src, { now: NOW, money });
    } catch (e) {
      assert.fail(`threw on ${JSON.stringify(src)}: ${String(e)}`);
    }
    for (const r of result.lines) {
      if (r.kind === "error") assert.notEqual(r.code, "internal", `internal error on ${JSON.stringify(src)}`);
      if (r.kind !== "value") continue;
      const v = r.value;
      assert.ok(Number.isFinite(v.k === "date" ? v.t : v.v), `non-finite on ${JSON.stringify(src)}`);
      const shown = formatValue(v, "en-US");
      assert.ok(!/NaN|Infinity|undefined|null|\[object/.test(shown), `${JSON.stringify(src)} shows ${shown}`);
    }
  }
});

test("the source holds no eval or Function", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL(".", import.meta.url);
  for (const f of readdirSync(dir).filter((n) => /\.(ts|tsx)$/.test(n) && !n.endsWith(".test.ts"))) {
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.ok(!/\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/.test(src), `${f} calls eval or Function`);
  }
});
