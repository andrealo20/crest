import { test } from "node:test";
import assert from "node:assert/strict";
import { amountText, parseAmount } from "./parse.ts";

test("a converted value goes back into the amount in the language's decimal mark, Latin digits, and reads back the same", () => {
  assert.equal(amountText(108.3249, "en"), "108.32");
  assert.equal(amountText(108.3249, "it"), "108,32");
  assert.equal(amountText(15890, "de"), "15890");
  assert.equal(amountText(0.004, "en"), "0");
  // Arabic writes its own digits and decimal mark, which the field does not read: the text stays in Latin digits.
  assert.match(amountText(108.32, "ar"), /^[\d.,]+$/);
  for (const [v, l] of [[108.32, "it"], [1234.5, "de"], [0.07, "en"], [15890, "ja"], [108.32, "ar"], [2.5, "fr"]] as const) assert.equal(parseAmount(amountText(v, l), l), v, l);
});

test("plain numbers and either decimal mark", () => {
  assert.equal(parseAmount("100"), 100);
  assert.equal(parseAmount("12.5"), 12.5);
  assert.equal(parseAmount("1,5"), 1.5);
  assert.equal(parseAmount("0,500"), 0.5);
  assert.equal(parseAmount("-40"), -40);
  assert.equal(parseAmount("12."), 12);
});

test("thousands separators", () => {
  assert.equal(parseAmount("1,000"), 1000);
  assert.equal(parseAmount("1,000.50"), 1000.5);
  assert.equal(parseAmount("1.234,5"), 1234.5);
  assert.equal(parseAmount("1.234.567"), 1234567);
  assert.equal(parseAmount("1,234,567"), 1234567);
  assert.equal(parseAmount("1 000"), 1000);
});

test("a lone mark before three digits follows the language's decimal mark", () => {
  assert.equal(parseAmount("1,250", "de"), 1.25);
  assert.equal(parseAmount("1.250", "de"), 1250);
  assert.equal(parseAmount("0.500", "de"), 0.5);
  assert.equal(parseAmount("1.250", "en"), 1.25);
  assert.equal(parseAmount("1,250", "en"), 1250);
  assert.equal(parseAmount("1.250,5", "de"), 1250.5);
});

test("nothing to read gives null", () => {
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("  "), null);
  assert.equal(parseAmount("-"), null);
  assert.equal(parseAmount("1,2,3.4.5"), null);
});
