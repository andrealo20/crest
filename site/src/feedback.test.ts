import assert from "node:assert/strict";
import test from "node:test";
import { validate, type Report } from "./feedback.ts";

const ok: Report = { message: "The notch does not open.", email: "", version: "", system: "", files: [] };

test("a message alone is enough", () => {
  assert.deepEqual(validate(ok), {});
  assert.deepEqual(validate({ ...ok, email: "ada@example.com", version: "1.1.0", system: "Windows 11 24H2", files: [{ name: "crash.log", size: 10 }] }), {});
});

test("each field says what is wrong with it", () => {
  const found = validate({ message: "  ", email: "ada@", version: "1.1 beta", system: " macOS", files: [{ name: "a.exe", size: 1 }] });
  assert.deepEqual(Object.keys(found).sort(), ["attachments", "email", "message", "system", "version"]);
});

test("the limits the Worker enforces", () => {
  assert.ok(validate({ ...ok, message: "x".repeat(5001) }).message);
  assert.deepEqual(validate({ ...ok, message: `${"x".repeat(4999)}\r\n` }), {}); // trimmed, CRLF counts once
  assert.ok(validate({ ...ok, email: "àda@example.com" }).email);
  assert.ok(validate({ ...ok, files: Array.from({ length: 11 }, (_, i) => ({ name: `${i}.png`, size: 1 })) }).attachments);
  assert.ok(validate({ ...ok, files: [{ name: "a.png", size: 3 * 1048576 + 1 }] }).attachments);
});
