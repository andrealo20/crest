import { test } from "node:test";
import assert from "node:assert/strict";
import { compatible, defaultValues, engineLang, extOf, outputsOf, priceShown, startRun, step, tabsOf, type Op, type RunLine } from "./model.ts";

const op = (id: string, patch: Partial<Op> = {}): Op => ({ id, tab: "convert", name: id, kinds: [], extensions: [], output: null, options: [], multi: true, secret: false, ...patch });

test("only operations that take every file are offered, by extension, however many files", () => {
  // As the engine's catalog has them: conversions give one result per file (multi false), a merge joins them (multi true).
  const ops = [
    op("png", { extensions: [".jpg", ".PNG"], multi: false }),
    op("merge", { tab: "tools", extensions: [".pdf"] }),
    op("lock", { tab: "actions", extensions: [".pdf"], multi: false }),
    op("any", { tab: "actions" }),
  ];
  assert.deepEqual(compatible(ops, ["C:\\a\\x.JPG", "C:\\a\\y.png", "C:\\a\\z.jpg"]).map((o) => o.id), ["png", "any"]);
  assert.deepEqual(compatible(ops, ["C:\\a\\x.pdf"]).map((o) => o.id), ["merge", "lock", "any"]);
  assert.deepEqual(compatible(ops, ["C:\\a\\x.pdf", "C:\\b.c\\y.pdf"]).map((o) => o.id), ["merge", "lock", "any"]);
  assert.deepEqual(compatible(ops, []), []);
  assert.deepEqual(tabsOf(compatible(ops, ["C:\\a\\x.pdf"])), ["tools", "actions"]);
  assert.equal(extOf("C:\\a.b\\noext"), "");
  assert.equal(extOf("C:\\a\\.hidden"), "");
});

test("options start at their defaults, as strings the engine takes", () => {
  const o = op("x", {
    options: [
      { id: "quality", type: "int", label: "", default: 80.4, min: 1, max: 100, choices: [] },
      { id: "strip", type: "bool", label: "", default: true, choices: [] },
      { id: "size", type: "choice", label: "", default: "nope", choices: [{ id: "s", label: "S" }, { id: "m", label: "M" }] },
      { id: "name", type: "text", label: "", default: null, choices: [] },
    ],
  });
  assert.deepEqual(defaultValues(o), { quality: "80", strip: "true", size: "s", name: "" });
});

test("a run follows the engine's lines file by file", () => {
  const lines: RunLine[] = [
    { type: "start", index: 0, file: "a" },
    { type: "progress", index: 0, fraction: 1.7 },
    { type: "done", index: 0, outputs: ["a.png"] },
    { type: "allowance", left: 16 },
    { type: "start", index: 1, file: "b" },
    { type: "busy", index: 1, seconds: 3 },
    { type: "error", index: 1, code: "damaged", message: "Broken file" },
    { type: "progress", index: 9, fraction: 0.5 },
    { type: "end", ok: 1, failed: 1 },
  ];
  const states = lines.reduce((list, line) => [...list, step(list[list.length - 1], line)], [startRun(["a", "b"])]);
  assert.equal(states[2].files[0].fraction, 1);
  assert.equal(states[6].files[1].fraction, null);
  const last = states[states.length - 1];
  assert.deepEqual(last.files.map((f) => f.status), ["done", "error"]);
  assert.equal(last.files[1].error?.code, "damaged");
  assert.deepEqual([last.left, last.ended, last.locked], [16, true, false]);
  assert.deepEqual(outputsOf(last), ["a.png"]);
  assert.deepEqual(step(startRun(["a"]), { type: "locked", left: 0 }).locked, true);
  // An operation that does not fit the files says so before any file; one that writes no file gives text.
  const unfit = step(startRun(["a"]), { type: "error", index: -1, code: "unsupported", message: "Only MKV files" });
  assert.deepEqual([unfit.problem, unfit.ended, unfit.files[0].status], ["Only MKV files", true, "waiting"]);
  const sum = step(startRun(["a"]), { type: "done", index: 0, outputs: [], text: "sha256 abc" });
  assert.deepEqual([sum.files[0].text, outputsOf(sum)], ["sha256 abc", []]);
  assert.equal(engineLang("zh-CN"), "zh-Hans");
  assert.equal(engineLang("pt-BR"), "pt-BR");
});

test("the licence shows a launch offer only with a usual price and an end still ahead", () => {
  const end = Date.parse("2026-12-31T23:59:59Z");
  const offer = { price: "4.99", was: "9.99", until: "2026-12-31T23:59:59Z" };
  assert.deepEqual(priceShown(offer, end - 1), { price: "4.99", was: "9.99", until: new Date(end) });
  // Over, by this PC's clock: the price alone, never the offer.
  assert.deepEqual(priceShown(offer, end), { price: "4.99" });
  assert.deepEqual(priceShown(offer, end + 86_400_000), { price: "4.99" });
  // After the end the engine gives the usual price alone.
  assert.deepEqual(priceShown({ price: "9.99" }, end + 1), { price: "9.99" });
  // An older engine without the field: the panel keeps its own text.
  assert.equal(priceShown(undefined, end), null);
  // Half an offer, or one that is not one, shows the price only.
  assert.deepEqual(priceShown({ price: "4.99", was: "9.99" }, 0), { price: "4.99" });
  assert.deepEqual(priceShown({ price: "4.99", until: "2026-12-31T23:59:59Z" }, 0), { price: "4.99" });
  assert.deepEqual(priceShown({ price: "4.99", was: "9.99", until: "soon" }, 0), { price: "4.99" });
  assert.deepEqual(priceShown({ price: "9.99", was: "4.99", until: "2026-12-31T23:59:59Z" }, 0), { price: "9.99" });
  assert.deepEqual(priceShown({ price: "4.99", was: "<b>9</b>", until: "2026-12-31T23:59:59Z" }, 0), { price: "4.99" });
  // A price that is not dollars and cents is no price.
  for (const price of ["", "4,99", "4.9", "free", "99999.00", "-1.00"]) assert.equal(priceShown({ price }, 0), null, price);
  assert.equal(priceShown({ price: 4.99 as unknown as string }, 0), null);
});
