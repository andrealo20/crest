/*
 * Units for Calc. The Converter keeps its table inside a React file (units.tsx) with no export, and it has no time or
 * angle units, so Calc has its own: the same factors for the units both have, plus time and angles.
 * Every unit has a factor to its category's base unit (m, kg, l, m/s, s, rad); temperature uses its own formulas.
 */

export type Category = "length" | "mass" | "temp" | "volume" | "speed" | "time" | "angle";

export interface UnitDef {
  id: string;
  cat: Category;
  /** How a result is written: "km", "°C". */
  symbol: string;
  /** Factor to the category's base unit; unused for temperature. */
  factor: number;
  /** Names a line can use. Looked up as typed, then in lower case; "K" has a capital because a lone k is no unit ("5k"). */
  names: string[];
}

const u = (id: string, cat: Category, symbol: string, factor: number, ...names: string[]): UnitDef => ({ id, cat, symbol, factor, names: [id, ...names] });

export const UNITS: UnitDef[] = [
  u("mm", "length", "mm", 0.001, "millimeter", "millimeters", "millimetre", "millimetres"),
  u("cm", "length", "cm", 0.01, "centimeter", "centimeters", "centimetre", "centimetres"),
  u("m", "length", "m", 1, "meter", "meters", "metre", "metres"),
  u("km", "length", "km", 1000, "kilometer", "kilometers", "kilometre", "kilometres"),
  u("in", "length", "in", 0.0254, "inch", "inches"),
  u("ft", "length", "ft", 0.3048, "foot", "feet"),
  u("yd", "length", "yd", 0.9144, "yard", "yards"),
  u("mi", "length", "mi", 1609.344, "mile", "miles"),

  u("mg", "mass", "mg", 1e-6, "milligram", "milligrams"),
  u("g", "mass", "g", 0.001, "gram", "grams"),
  u("kg", "mass", "kg", 1, "kilo", "kilos", "kilogram", "kilograms"),
  u("t", "mass", "t", 1000, "tonne", "tonnes"),
  u("oz", "mass", "oz", 0.028349523125, "ounce", "ounces"),
  u("lb", "mass", "lb", 0.45359237, "lbs", "pound", "pounds"),

  u("c", "temp", "°C", 1, "°c", "celsius", "degc"),
  u("f", "temp", "°F", 1, "°f", "fahrenheit", "degf"),
  u("K", "temp", "K", 1, "kelvin"),

  u("ml", "volume", "ml", 0.001, "milliliter", "milliliters", "millilitre", "millilitres"),
  u("l", "volume", "l", 1, "liter", "liters", "litre", "litres"),
  u("m3", "volume", "m³", 1000, "m³"),
  u("tsp", "volume", "tsp", 0.00492892159375, "teaspoon", "teaspoons"),
  u("tbsp", "volume", "tbsp", 0.01478676478125, "tablespoon", "tablespoons"),
  u("cup", "volume", "cup", 0.2365882365, "cups"),
  u("floz", "volume", "fl oz", 0.0295735295625),
  u("gal", "volume", "gal", 3.785411784, "gallon", "gallons"),

  u("m/s", "speed", "m/s", 1, "mps"),
  u("km/h", "speed", "km/h", 1 / 3.6, "kmh", "kph"),
  u("mph", "speed", "mph", 0.44704),
  u("kn", "speed", "kn", 1852 / 3600, "knot", "knots", "kt"),

  // A month is 1/12 of a year of 365.25 days; dates add whole months and years on the calendar instead (see engine.ts).
  u("ms", "time", "ms", 0.001, "millisecond", "milliseconds"),
  u("s", "time", "s", 1, "sec", "secs", "second", "seconds"),
  u("min", "time", "min", 60, "mins", "minute", "minutes"),
  u("h", "time", "h", 3600, "hr", "hrs", "hour", "hours"),
  u("d", "time", "d", 86400, "day", "days"),
  u("wk", "time", "wk", 604800, "week", "weeks"),
  u("mo", "time", "mo", 2629800, "month", "months"),
  u("yr", "time", "yr", 31557600, "y", "yrs", "year", "years"),

  u("deg", "angle", "°", Math.PI / 180, "°", "degree", "degrees"),
  u("rad", "angle", "rad", 1, "rads", "radian", "radians"),
];

const byName = new Map<string, UnitDef>();
for (const def of UNITS) for (const n of def.names) byName.set(n, def);

/** The unit a word names ("km", "Miles", "°F"), or undefined. */
export function findUnit(name: string): UnitDef | undefined {
  return byName.get(name) ?? byName.get(name.toLowerCase());
}

const toCelsius = (v: number, id: string) => (id === "f" ? ((v - 32) * 5) / 9 : id === "K" ? v - 273.15 : v);
const fromCelsius = (v: number, id: string) => (id === "f" ? (v * 9) / 5 + 32 : id === "K" ? v + 273.15 : v);

/** `value` of `from` in `to`; both are of one category (the caller checks). */
export function convertUnits(value: number, from: UnitDef, to: UnitDef): number {
  if (from.cat === "temp") return fromCelsius(toCelsius(value, from.id), to.id);
  return (value * from.factor) / to.factor;
}

/** Currencies the ECB publishes rates for (the Converter's source), the only ones a line can name. */
export const CURRENCIES = new Set([
  "AUD", "BGN", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN",
  "MYR", "NOK", "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
]);

export const SYMBOL_CURRENCY: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY" };
