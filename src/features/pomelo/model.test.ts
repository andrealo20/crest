import { test } from "node:test";
import assert from "node:assert/strict";
import { controlOf, defaultsOf, listText, packageNeed, parseList, parseSchema, parseWhole, shownRows, valueOf, valuesOf, visible, type SchemaRow } from "./model.ts";

const row = (patch: Partial<SchemaRow> & Pick<SchemaRow, "key" | "type">): SchemaRow => ({ label: patch.key, ...patch });

test("the schema keeps the pages, groups and rows Crest can draw", () => {
  const pages = parseSchema({
    pages: [
      {
        id: "wheel",
        title: "Wheel",
        icon: "wheel",
        groups: [
          {
            title: "Wheel",
            rows: [
              { key: "wheel.size", type: "int", label: "Size", default: 240, min: 160, max: 400, step: 10 },
              { key: "wheel.mode", type: "choice", label: "Mode", choices: [{ id: "a", label: "A" }, { id: 2, label: "bad" }] },
              { key: "nochoices", type: "choice", label: "Empty", choices: [] },
              { key: "odd", type: "slider", label: "Unknown type" },
              { key: "nolabel", type: "bool" },
              { key: "recipes", type: "custom", label: "Recipes" },
              "not a row",
            ],
          },
          { title: "Empty", rows: [{ key: "x", type: "nope", label: "X" }] },
        ],
      },
      { id: "Bad Id", title: "Bad", groups: [] },
      { id: "files", groups: [] },
      "nope",
    ],
  });
  assert.deepEqual(pages.map((p) => p.id), ["wheel"]);
  assert.equal(pages[0].groups.length, 1);
  assert.deepEqual(pages[0].groups[0].rows.map((r) => r.key), ["wheel.size", "wheel.mode", "recipes"]);
  assert.deepEqual(pages[0].groups[0].rows[1].choices, [{ id: "a", label: "A" }]);
  // A custom row without its own action opens the page named by its key.
  assert.equal(pages[0].groups[0].rows[2].action, "recipes");
  assert.deepEqual(parseSchema(null), []);
  assert.deepEqual(parseSchema({ pages: "x" }), []);
});

test("each row type gets its Crest control", () => {
  assert.equal(controlOf(row({ key: "a", type: "bool" })), "switch");
  assert.equal(controlOf(row({ key: "a", type: "int", min: 0, max: 100 })), "slider");
  assert.equal(controlOf(row({ key: "a", type: "int", min: 0, max: 5000, step: 50 })), "slider");
  assert.equal(controlOf(row({ key: "a", type: "int", min: 1, max: 65536 })), "number");
  assert.equal(controlOf(row({ key: "a", type: "int" })), "number");
  const choices = (n: number, label = "Short") => Array.from({ length: n }, (_, i) => ({ id: `${i}`, label }));
  assert.equal(controlOf(row({ key: "a", type: "choice", choices: choices(3) })), "segmented");
  assert.equal(controlOf(row({ key: "a", type: "choice", choices: choices(4) })), "select");
  assert.equal(controlOf(row({ key: "a", type: "choice", choices: choices(2, "A rather long label") })), "select");
  assert.equal(controlOf(row({ key: "a", type: "text" })), "text");
  assert.equal(controlOf(row({ key: "a", type: "keys" })), "text");
  assert.equal(controlOf(row({ key: "a", type: "list" })), "list");
  assert.equal(controlOf(row({ key: "a", type: "custom" })), "button");
});

test("visibleIf follows the other setting, saved or by default", () => {
  const glass = row({ key: "glass", type: "bool", default: true });
  const tint = row({ key: "tint", type: "choice", choices: [{ id: "a", label: "A" }], visibleIf: { key: "glass", equals: true } });
  const size = row({ key: "size", type: "int", default: 3 });
  const group = { rows: [glass, tint, size] };
  const defaults = defaultsOf([{ id: "p", title: "P", groups: [group] }]);
  assert.deepEqual(defaults, { glass: true, tint: undefined, size: 3 });
  assert.deepEqual(shownRows(group, {}, defaults).map((r) => r.row.key), ["glass", "tint", "size"]);
  assert.deepEqual(shownRows(group, { glass: false }, defaults).map((r) => [r.row.key, r.control]), [["glass", "switch"], ["size", "number"]]);
  assert.equal(visible(row({ key: "x", type: "bool", visibleIf: { key: "list", equals: ["a"] } }), { list: ["a"] }, {}), true);
  assert.equal(visible(row({ key: "x", type: "bool", visibleIf: { key: "missing", equals: 1 } }), {}, {}), false);
  assert.equal(valueOf(size, {}), 3);
  assert.equal(valueOf(size, { size: 7 }), 7);
});

test("values, typed numbers and lists", () => {
  assert.deepEqual(valuesOf({ values: { a: 1 } }), { a: 1 });
  assert.deepEqual(valuesOf({ a: 1 }), { a: 1 });
  assert.deepEqual(valuesOf("x"), {});
  const limit = row({ key: "n", type: "int", min: 1, max: 10 });
  assert.equal(parseWhole(limit, " 7 "), 7);
  assert.equal(parseWhole(limit, "0"), undefined);
  assert.equal(parseWhole(limit, "1.5"), undefined);
  assert.equal(parseWhole(limit, "ten"), undefined);
  assert.equal(parseWhole(row({ key: "n", type: "int" }), "-4"), -4);
  assert.equal(listText([".tmp", ".part"]), ".tmp, .part");
  assert.equal(listText("x"), "");
  assert.deepEqual(parseList(" .tmp, ,.part "), [".tmp", ".part"]);
});

test("the package needs an update without the wheel, a download without anything", () => {
  assert.equal(packageNeed({ version: "1.1.0", wheel: true, outdated: false }), "ready");
  assert.equal(packageNeed({ version: "1.1.0", wheel: false, outdated: false }), "update");
  assert.equal(packageNeed({ version: null, wheel: false, outdated: true }), "update");
  assert.equal(packageNeed({ version: null, wheel: false, outdated: false }), "download");
});
