import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, indentJson, MAX_DECODE_CHARS, type Decoded } from "./decode.ts";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const token = (header: unknown, payload: unknown, sig = "c2lnbmF0dXJl") => `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}.${sig}`;
const kind = (s: string, now?: number) => decode(s, now)?.kind ?? null;
function as<K extends Decoded["kind"]>(s: string, k: K, now?: number): Extract<Decoded, { kind: K }> {
  const d = decode(s, now);
  assert.equal(d?.kind, k, s);
  return d as Extract<Decoded, { kind: K }>;
}

// ---- JWT -------------------------------------------------------------------------------------------------------------

const SAMPLE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

test("a JWT shows its header and payload, indented, with no expiry when there is no exp", () => {
  const d = as(SAMPLE, "jwt");
  assert.equal(d.header, '{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
  assert.equal(d.payload, '{\n  "sub": "1234567890",\n  "name": "John Doe",\n  "iat": 1516239022\n}');
  assert.equal(d.exp, null);
  assert.equal(d.expired, false);
  assert.equal(d.copy, `${d.header}\n\n${d.payload}`);
});

test("exp is read in seconds and a token is expired from that second on", () => {
  const t = token({ alg: "RS256" }, { sub: "a", exp: 1_700_000_000 });
  const before = as(t, "jwt", 1_699_999_999_999);
  assert.equal(before.exp, 1_700_000_000_000);
  assert.equal(before.expired, false);
  assert.equal(as(t, "jwt", 1_700_000_000_000).expired, true);
  assert.equal(as(t, "jwt", 1_800_000_000_000).expired, true);
});

test("an exp that is not a usable number is ignored", () => {
  for (const exp of ["1700000000", null, true, [1], { a: 1 }, 1e300, Number.MAX_SAFE_INTEGER]) {
    const d = as(token({ alg: "HS256" }, { exp }), "jwt", 1_800_000_000_000);
    assert.equal(d.exp, null, String(exp));
    assert.equal(d.expired, false);
  }
  assert.equal(as(token({ alg: "HS256" }, { exp: 0 }), "jwt", 1).expired, true);
});

test("a JWT is found behind Bearer, with spaces around it, and without a signature (alg none)", () => {
  assert.equal(kind(`Bearer ${SAMPLE}`), "jwt");
  assert.equal(kind(`bearer   ${SAMPLE}`), "jwt");
  assert.equal(kind(`\n  ${SAMPLE}\r\n`), "jwt");
  assert.equal(kind(token({ alg: "none" }, { a: 1 }, "")), "jwt");
});

test("big numbers and key order in a JWT survive untouched", () => {
  const raw = `{"z":1,"id":9007199254740993,"a":1.50}`;
  const t = `${b64url('{"alg":"HS256"}')}.${b64url(raw)}.x`;
  assert.equal(as(t, "jwt").payload, '{\n  "z": 1,\n  "id": 9007199254740993,\n  "a": 1.50\n}');
});

test("things that look like a JWT but are not", () => {
  const ok = token({ alg: "HS256" }, { a: 1 });
  const [h, p] = ok.split(".");
  const no = [
    `${h}.${p}`, // two parts
    `${ok}.extra`, // four parts
    `${h}..sig`, // empty payload
    `.${p}.sig`, // empty header
    token({ typ: "JWT" }, { a: 1 }), // no alg
    token({ alg: 256 }, { a: 1 }), // alg is not a string
    token([1, 2], { a: 1 }), // header is an array
    token({ alg: "HS256" }, [1]), // payload is an array
    token({ alg: "HS256" }, "text"), // payload is a string
    token({ alg: "HS256" }, 42),
    `${h}.${b64url("not json")}.sig`,
    `${b64url("not json")}.${p}.sig`,
    `${h}.${p}.sig nature`, // space in the signature
    `${h}.${p}.si+g`, // standard alphabet in a signature
    `${h}.${p}.sig=`, // padding
    "www.example.com",
    "com.example.app",
    "archive.tar.gz",
    "1.2.3",
    "v10.20.30",
    "a.b.c",
    "192.168.1.1",
    "user.name@mail.example.com",
    "node.js.org",
    "...",
    "..",
    ".",
    "foo.bar",
  ];
  for (const s of no) assert.equal(kind(s), null, s);
});

test("a JWT nested far too deep gets no chip", () => {
  const deep = "[".repeat(60) + "1" + "]".repeat(60);
  assert.equal(kind(`${b64url('{"alg":"HS256"}')}.${b64url(`{"a":${deep}}`)}.x`), null);
});

// ---- Unix time -------------------------------------------------------------------------------------------------------

test("seconds and milliseconds become a date", () => {
  const s = as("1700000000", "time");
  assert.deepEqual([s.unit, s.ms, s.copy], ["s", 1_700_000_000_000, "2023-11-14T22:13:20.000Z"]);
  const ms = as("1700000000123", "time");
  assert.deepEqual([ms.unit, ms.ms, ms.copy], ["ms", 1_700_000_000_123, "2023-11-14T22:13:20.123Z"]);
  assert.equal(as("  1700000000\n", "time").ms, 1_700_000_000_000);
});

test("the plausible range is 2000 up to but not including 2100, both units", () => {
  assert.equal(as("946684800", "time").copy, "2000-01-01T00:00:00.000Z");
  assert.equal(kind("946684799"), null);
  assert.equal(as("4102444799", "time").copy, "2099-12-31T23:59:59.000Z");
  assert.equal(kind("4102444800"), null);
  assert.equal(as("946684800000", "time").unit, "ms");
  assert.equal(kind("946684799999"), null);
  assert.equal(as("4102444799999", "time").copy, "2099-12-31T23:59:59.999Z");
  assert.equal(kind("4102444800000"), null);
});

test("numbers that are not timestamps", () => {
  const no = [
    "12345", "2024", "0", "123456789", "99999999999", // too small, or the 11 digits that fit neither unit
    "17000000000000", "170000000000000000", // 14 digits and more
    "01700000000", "0946684800", // leading zero
    "-1700000000", "+1700000000", "1700000000.5", "1,700,000,000", "1_700_000_000", "1e9", "0x65536f00", "1700000000s", "1700000000 1700000000",
    "١٧٠٠٠٠٠٠٠٠", // Arabic-Indic digits
  ];
  for (const s of no) assert.equal(kind(s), null, s);
});

// ---- UUID ------------------------------------------------------------------------------------------------------------

test("a UUID shows its version, in any case and in GUID braces", () => {
  const v4 = as("550e8400-e29b-41d4-a716-446655440000", "uuid");
  assert.deepEqual([v4.version, v4.nil, v4.copy], [4, false, "550e8400-e29b-41d4-a716-446655440000"]);
  assert.equal(as("550E8400-E29B-41D4-A716-446655440000", "uuid").copy, "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(as("{3F2504E0-4F89-11D3-9A0C-0305E82C3301}", "uuid").version, 1);
  assert.equal(as("{3F2504E0-4F89-11D3-9A0C-0305E82C3301}", "uuid").copy, "3f2504e0-4f89-11d3-9a0c-0305e82c3301");
  assert.equal(as("018f3c5e-7a2b-7cde-8f12-3456789abcde", "uuid").version, 7);
  for (const v of [1, 2, 3, 4, 5, 6, 7, 8]) assert.equal(as(`00000000-0000-${v}000-8000-000000000000`, "uuid").version, v);
});

test("the nil UUID, and a variant or version that is not the standard one", () => {
  const nil = as("00000000-0000-0000-0000-000000000000", "uuid");
  assert.deepEqual([nil.version, nil.nil], [null, true]);
  assert.equal(as("ffffffff-ffff-ffff-ffff-ffffffffffff", "uuid").version, null);
  assert.equal(as("550e8400-e29b-41d4-c716-446655440000", "uuid").version, null); // Microsoft variant
  assert.equal(as("550e8400-e29b-91d4-a716-446655440000", "uuid").version, null); // version 9
  assert.equal(as("550e8400-e29b-01d4-a716-446655440000", "uuid").version, null); // version 0
});

test("things that look like a UUID but are not", () => {
  const no = [
    "550e8400e29b41d4a716446655440000", // no hyphens: reads as a hash
    "550e8400-e29b-41d4-a716-44665544000", // one digit short
    "550e8400-e29b-41d4-a716-4466554400000",
    "550e8400-e29b-41d4-a716",
    "550e8400-e29b-41d4-a716-44665544000g",
    "550e8400_e29b_41d4_a716_446655440000",
    "{550e8400-e29b-41d4-a716-446655440000",
    "550e8400-e29b-41d4-a716-446655440000}",
    "(550e8400-e29b-41d4-a716-446655440000)",
    "550e8400-e29b-41d4-a716-446655440000-1",
    "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
    "550e8400-e29b-41d4-a716-446655440000 550e8400-e29b-41d4-a716-446655440000",
  ];
  for (const s of no) assert.equal(kind(s), null, s);
});

// ---- JSON ------------------------------------------------------------------------------------------------------------

test("JSON is indented, with its key order and numbers untouched", () => {
  const d = as('{"a":[1,2,{"b":null}],"c":"x, y","d":{},"e":[], "f" : -0.50e+2}', "json");
  assert.equal(
    d.pretty,
    '{\n  "a": [\n    1,\n    2,\n    {\n      "b": null\n    }\n  ],\n  "c": "x, y",\n  "d": {},\n  "e": [],\n  "f": -0.50e+2\n}',
  );
  assert.equal(d.copy, d.pretty);
  assert.equal(as('{"id":9007199254740993,"z":1,"a":2,"z":3}', "json").pretty, '{\n  "id": 9007199254740993,\n  "z": 1,\n  "a": 2,\n  "z": 3\n}');
  assert.equal(as("[1,2]", "json").pretty, "[\n  1,\n  2\n]");
});

test("strings keep everything inside them", () => {
  const raw = '{"a b":"c  d","q":"say \\"hi, {there}\\"","path":"C:\\\\x\\\\y","u":"\\u00e9 [x]:","t":"tab\\t"}';
  const d = as(raw, "json");
  assert.deepEqual(JSON.parse(d.pretty), JSON.parse(raw));
  assert.ok(d.pretty.includes('"say \\"hi, {there}\\""'));
  assert.ok(d.pretty.includes('"a b": "c  d"'));
});

test("formatting never changes the meaning, and formatting twice changes nothing more", () => {
  const samples = [
    '[{"a":1},{"b":[true,false,null]},[],{}]',
    '{"x":{"y":{"z":[[1,[2,[3]]]]}}}',
    ' \n[ 1 ,\n 2 , "a,b" ]\t',
    '{"":"","\\"":"\\\\"}',
    '[1.0,2.50,-0,1e5,1E-5]',
  ];
  for (const raw of samples) {
    const once = as(raw, "json").pretty;
    assert.deepEqual(JSON.parse(once), JSON.parse(raw), raw);
    assert.equal(indentJson(once), once, raw);
  }
});

test("JSON that is not worth a chip", () => {
  const no = [
    "{}", "[]", "{ }", "[ ]", "123", '"text"', "true", "null",
    "{'a':1}", "{a:1}", '{"a":1,}', '{"a":1', '["a",]', "[1 2]", '{"a" 1}', "[TODO]", "[x]", "[1, 2, 3", "{{}}", "[link](https://example.com)",
    "[Image 1]", "{{name}}", "{% if x %}", "[INFO] started]",
    "{\"a\":1} trailing", "x {\"a\":1}",
  ];
  for (const s of no) assert.equal(kind(s), null, s);
});

test("nesting deeper than 40 levels gets no chip, 40 still does", () => {
  const nest = (n: number) => "[".repeat(n) + "1" + "]".repeat(n);
  assert.equal(kind(nest(40)), "json");
  assert.equal(kind(nest(41)), null);
  assert.equal(kind(nest(50_000)), null);
});

// ---- Colour ----------------------------------------------------------------------------------------------------------

test("hex colours become rgb and hsl", () => {
  const d = as("#ff8800", "color");
  assert.deepEqual([d.hex, d.rgb, d.hsl, d.copy], ["#ff8800", [255, 136, 0], [32, 100, 50], "rgb(255, 136, 0)"]);
  const short = as("#FA0", "color");
  assert.deepEqual([short.hex, short.rgb], ["#ffaa00", [255, 170, 0]]);
  assert.equal(as("#FF8800", "color").hex, "#ff8800");
  assert.deepEqual(as("#f00", "color").hsl, [0, 100, 50]);
  assert.deepEqual(as("#0f0", "color").hsl, [120, 100, 50]);
  assert.deepEqual(as("#00f", "color").hsl, [240, 100, 50]);
  assert.deepEqual(as("#808080", "color").hsl, [0, 0, 50]);
  assert.deepEqual(as("#000", "color").hsl, [0, 0, 0]);
  assert.deepEqual(as("#ffffff", "color").hsl, [0, 0, 100]);
  assert.deepEqual(as("#ff0080", "color").hsl, [330, 100, 50]);
  assert.deepEqual(as(" #123456\n", "color").rgb, [18, 52, 86]);
});

test("short codes without a letter are issue numbers, except the greys", () => {
  for (const s of ["#123", "#404", "#100", "#808", "#007", "#910"]) assert.equal(kind(s), null, s);
  for (const s of ["#000", "#111", "#333", "#999", "#fff", "#abc", "#0a0", "#f00"]) assert.equal(kind(s), "color", s);
});

test("things that look like a colour but are not", () => {
  const no = ["#", "#f", "#ff", "#ffff", "#fffff", "#fffffff", "#ff880080", "#ggg", "#gg8800", "#ff 88 00", "#ff8800;", "ff8800", "fff", "#fff fff", "##fff", "#fff\n#000", "#!/bin/bash", "#hashtag", "#12345", "#1234567", "rgb(1, 2, 3)"];
  for (const s of no) assert.equal(kind(s), null, s);
});

// ---- Base64 ----------------------------------------------------------------------------------------------------------

test("Base64 that is text decodes", () => {
  const yes: [string, string][] = [
    ["SGVsbG8gV29ybGQ=", "Hello World"],
    ["SGVsbG8=", "Hello"],
    ["dGVzdA==", "test"],
    ["dXNlcjpwYXNz", "user:pass"],
    ["YWRtaW46YWRtaW4=", "admin:admin"],
    ["aGVsbG8K", "hello\n"],
    ["eyJhIjoxfQ==", '{"a":1}'],
    ["WzEsMiwzXQ==", "[1,2,3]"],
    [b64("The quick brown fox jumps over the lazy dog"), "The quick brown fox jumps over the lazy dog"],
    [b64("user@example.com"), "user@example.com"],
    [b64("Caffè latte e crème brûlée"), "Caffè latte e crème brûlée"],
    [b64("こんにちは世界"), "こんにちは世界"],
    [b64("Привет, мир"), "Привет, мир"],
    [b64("Hello 👋 world"), "Hello 👋 world"],
    [b64("-----BEGIN CERTIFICATE-----\nMIIB"), "-----BEGIN CERTIFICATE-----\nMIIB"],
    [b64("line one\r\nline two\r\n\tindented"), "line one\r\nline two\r\n\tindented"],
  ];
  for (const [enc, text] of yes) {
    const d = as(enc, "base64");
    assert.equal(d.text, text, enc);
    assert.equal(d.copy, text);
  }
});

test("URL-safe Base64 decodes too", () => {
  const text = "Wait: what? >>> Yes! ??? ~~~ ok!!"; // 33 bytes: whole groups, so no padding
  const enc = b64url(text);
  assert.ok(/[-_]/.test(enc), enc);
  assert.equal(as(enc, "base64").text, text);
  const unpadded = b64url("Hello World!"); // 12 characters, no padding needed
  assert.equal(as(unpadded, "base64").text, "Hello World!");
});

test("Base64 without the full groups, or with a mix of both alphabets, is not taken for Base64", () => {
  assert.equal(kind("SGVsbG8"), null); // 7
  assert.equal(kind("SGVsbG8gV29ybGQ"), null); // 15, padding missing
  assert.equal(kind("SGVsbG8==="), null);
  assert.equal(kind("SGVsb=G8gV29ybGQ="), null); // padding in the middle
  assert.equal(kind("SGVs bG8g"), null);
  assert.equal(kind("SGVsbG8gV29y+GQ_"), null); // + and _ together
  assert.equal(kind("SGVsbG8gV29y/GQ-"), null);
});

test("Base64 of bytes that are not text is left alone", () => {
  const bytes = (...b: number[]) => Buffer.from(b).toString("base64");
  assert.equal(kind(bytes(0xff, 0xfe, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05)), null);
  assert.equal(kind(bytes(0xc3, 0x28, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66)), null); // invalid UTF-8
  assert.equal(kind(bytes(0x68, 0x65, 0x6c, 0x00, 0x6c, 0x6f, 0x21, 0x21)), null); // a NUL inside
  assert.equal(kind(bytes(0x68, 0x65, 0x6c, 0x1b, 0x6c, 0x6f, 0x21, 0x21)), null); // an escape
  assert.equal(kind("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), null); // a PNG
  assert.equal(kind("AAAAAAAA"), null);
  assert.equal(kind("AAAAAAAAAAAAAAAA"), null);
  assert.equal(kind("////////"), null);
  assert.equal(kind("++++++++"), null);
  assert.equal(kind("--------"), null);
  assert.equal(kind("________"), null);
  assert.equal(kind("TUlJQ3FnSUJBZ0lVWm9iV0ZMVU5uNm1Pa3o4bjQrYVFZ".replace("TUlJ", "/+/+")), null);
});

test("words, names and identifiers that are valid Base64 are not decoded", () => {
  const words = [
    "password", "Password", "keyboard", "elephant", "computer", "Christmas", "dictionary", "something", "basketball", "Wednesday",
    "internationalization", "configuration", "Installa", "Reanudar", "Quantity", "Readings", "endsWith", "cycleGpu", "bitpanda",
    "CloudFog", "Intraday", "useClipboard", "ClipboardView", "ClipItem", "springs", "Segmented", "tabular", "AnimatePresence",
    "IUnknown", "userName", "getUser", "isCode", "isJson", "filename", "username", "localhost", "javascript", "typescript",
    "Presentation", "Hardwares", "Thursdays", "yesterday", "tomorrow1", "Bergamot", "Pomelo123", "Crest2026", "abcdefgh",
    "ABCDEFGH", "abcdefghijkl", "12345678", "1234567890123456", "00000000", "deadbeef", "cafebabe", "feedface",
  ];
  for (const w of words) assert.equal(kind(w), null, w);
});

test("hashes, keys and ids are not decoded", () => {
  const hex = [
    "d41d8cd98f00b204e9800998ecf8427e", // md5
    "da39a3ee5e6b4b0d3255bfef95601890afd80709", // sha1
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // sha256
    "5547294", "2b29f26bd07a48622986f7e5a1a54ac0e79d3261",
  ];
  // Provider keys (Stripe, GitHub, AWS, Slack, Google) are put together from pieces: written out whole, a secret scanner takes them for real ones.
  const keys = [
    "sk_" + "live_4eC39HqLyjWDarjtT1zdp7dc", "ghp_" + "16C7e42F292c6912E7710c838347Ae178B4a", "AKIA" + "IOSFODNN7EXAMPLE",
    "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "xoxb" + "-1234-5678-abcdefghijkl", "AIza" + "SyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe",
    "3f2504e04f8911d39a0c0305e82c3301", "01HZX3Y7T5Q8N6V2M4B9C0D1EF", "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  ];
  for (const s of [...hex, ...keys]) assert.equal(kind(s), null, s);
});

// ---- Tracking parameters ---------------------------------------------------------------------------------------------

test("tracking parameters are cut and nothing else changes", () => {
  const d = as("https://example.com/page?utm_source=news&utm_medium=email&id=7#top", "tracking");
  assert.equal(d.clean, "https://example.com/page?id=7#top");
  assert.deepEqual(d.removed, ["utm_source", "utm_medium"]);
  assert.equal(d.copy, d.clean);
  // Order, encoding and odd characters of what stays are kept byte for byte.
  assert.equal(
    as("https://x.com/a%20b/?q=a%20b+c&utm_campaign=x&z=%C3%A9&k=1=2&flag", "tracking").clean,
    "https://x.com/a%20b/?q=a%20b+c&z=%C3%A9&k=1=2&flag",
  );
  assert.equal(as("https://x.com?fbclid=IwAR0&b=1", "tracking").clean, "https://x.com?b=1");
});

test("a link with only tracking parameters loses its question mark", () => {
  assert.equal(as("https://shop.example/p?gclid=abc123", "tracking").clean, "https://shop.example/p");
  assert.equal(as("https://shop.example/p?gclid=abc123#reviews", "tracking").clean, "https://shop.example/p#reviews");
  assert.equal(as("https://a.com/?utm_source", "tracking").clean, "https://a.com/");
});

test("the known click identifiers, in any case", () => {
  for (const name of ["fbclid", "gclid", "gbraid", "wbraid", "dclid", "msclkid", "twclid", "ttclid", "yclid", "igshid", "mc_cid", "mc_eid", "utm_source", "utm_id", "UTM_Source", "FbClid", "GCLID"]) {
    assert.equal(as(`https://a.com/p?${name}=1&x=2`, "tracking").clean, "https://a.com/p?x=2", name);
  }
});

test("paths and bare hosts count too", () => {
  assert.equal(as("/docs/page?utm_source=a", "tracking").clean, "/docs/page");
  assert.equal(as("./docs/page.html?utm_source=a&b=1", "tracking").clean, "./docs/page.html?b=1");
  assert.equal(as("example.com/a?fbclid=1", "tracking").clean, "example.com/a");
  assert.equal(as("www.example.com/?utm_term=x&y=1", "tracking").clean, "www.example.com/?y=1");
  assert.equal(as("file.html?utm_source=a", "tracking").clean, "file.html");
});

test("links without tracking, or only look-alikes, are left alone", () => {
  const no = [
    "https://example.com/?q=search&page=2",
    "https://example.com/",
    "https://example.com/?",
    "https://example.com/?utm=1",
    "https://example.com/?utm_=1",
    "https://example.com/?utm-source=1",
    "https://example.com/?gclidx=1",
    "https://example.com/?xgclid=1",
    "https://example.com/?my_utm_source=1",
    "https://example.com/?q=utm_source=1",
    "https://example.com/?q=fbclid",
    "https://example.com/#/route?utm_source=x", // the "?" belongs to the page's own route
    "what?utm_source=x", // a lone word
    "?utm_source=x",
    "see https://example.com/?utm_source=x", // prose around the link
    "https://example.com/?utm_source=x https://example.com/?utm_medium=y",
  ];
  for (const s of no) assert.equal(kind(s), null, s);
});

// ---- Everything else -------------------------------------------------------------------------------------------------

test("prose, code and ordinary one-liners get no chip", () => {
  const no = [
    "", " ", "\n\n", "\t",
    "Ship the smallest useful version, then learn from real behavior.",
    "Hi Dina,\n\nThanks for the update. I'll send the report tomorrow.\n\nBest,\nAndrea",
    "npm run tauri dev", "git commit -m \"Fix the build\"", "const x = 1;", "items.filter((x) => x.done)", "SELECT id, name FROM users WHERE active = 1",
    "<div className=\"row\">", "x = foo(bar)", "fn main() {\n    println!(\"hi\");\n}", "def add(a, b):\n    return a + b",
    "SpringVector3NaturalMotionAnimation", "C:\\Users\\me\\Documents\\file.txt", "/usr/local/bin/node", "john.doe@example.com", "+39 333 123 4567",
    "10 Downing Street\nLondon\nSW1A 2AA", "3.14159", "1,234.56", "2026-11-06", "2026-11-06T12:00:00Z", "12:30", "v1.2.3", "1.2.3.4", "Bearer", "Bearer token",
    "Bearer abc.def.ghi", "eyJ", "eyJ.eyJ.eyJ", "https://github.com/microsoft/windows-rs", "ok", "😀", "😀😀😀😀😀😀😀😀",
  ];
  for (const s of no) assert.equal(kind(s), null, JSON.stringify(s));
});

test("JSON wins when the text starts with a bracket, a colour when it starts with #", () => {
  assert.equal(kind('{"name": "crest", "version": "0.2.0"}'), "json");
  assert.equal(kind("[1, 2, 3]"), "json");
  assert.equal(kind("#fff"), "color");
});

test("texts over 100 KB are ignored, 100 KB itself is not", () => {
  const array = (len: number) => {
    const body = "[" + "1,".repeat(49_000) + "1]";
    return body + " ".repeat(len - body.length - 1) + "\n";
  };
  const ok = array(MAX_DECODE_CHARS);
  assert.equal(ok.length, MAX_DECODE_CHARS);
  assert.equal(kind(ok), "json");
  const over = array(MAX_DECODE_CHARS + 1);
  assert.equal(over.length, MAX_DECODE_CHARS + 1);
  assert.equal(kind(over), null);
  assert.equal(kind(b64("x".repeat(200_000))), null);
});

test("a long Base64 text decodes in full", () => {
  const text = "hello world, this is text. ".repeat(3000); // 81 000 characters, 108 000 as Base64: over the limit
  assert.equal(kind(b64(text)), null);
  const fits = "hello world, this is text. ".repeat(2000); // 54 000 characters, 72 000 as Base64
  assert.equal(as(b64(fits), "base64").text, fits);
});

test("odd and hostile inputs finish quickly and give nothing", () => {
  const N = 100_000;
  const inputs: Record<string, string> = {
    a: "a".repeat(N),
    A: "A".repeat(N - 4) + "====",
    "A pad": "A".repeat(N - 2) + "==",
    dots: ".".repeat(N),
    "a.": "a.".repeat(N / 2),
    "x.y.": "x.y.".repeat(N / 4),
    eyJ: "eyJ".repeat(N / 3 - 2) + ".eyJ.x",
    questions: "?".repeat(N),
    "http ?&": "http://a/?" + "&".repeat(N - 10),
    "http ?=": "http://a/?" + "=&".repeat((N - 10) / 2),
    "utm ×7000": "http://a/?" + "utm_source=1&".repeat(7000),
    "utm ×8000 + keep": "http://a/?" + "utm_source=1&".repeat(7000) + "k=1",
    "hash ?": "http://a/" + "#?".repeat(N / 2 - 5),
    "[ ]": "[".repeat(N / 2) + "]".repeat(N / 2),
    "{ }": '{"a":'.repeat(N / 10) + "1" + "}".repeat(N / 10),
    "[1,": "[" + "1,".repeat(N / 2 - 2) + "1",
    "[[": "[[" + "0,".repeat(N / 2 - 4) + "0]]",
    quotes: '["' + "\\".repeat(N - 5) + '"]', // an odd number of backslashes: the last one escapes the closing quote
    "{{": "{" + "{".repeat(N - 2) + "}",
    spaces: " ".repeat(N),
    "a ": "a ".repeat(N / 2),
    newlines: "\n".repeat(N),
    digits: "1".repeat(N),
    nines: "9".repeat(13) + "x".repeat(N - 13),
    dashes: "-".repeat(N),
    "e-": "e-".repeat(N / 2),
    emoji: "😀".repeat(N / 2),
    accents: "é".repeat(N),
    "Bearer ": "Bearer " + " ".repeat(N - 7),
    "Bearer a": "Bearer " + "a.".repeat((N - 7) / 2),
    hash: "#" + "f".repeat(N - 1),
    "# #": "# ".repeat(N / 2),
    uuid: "-".repeat(N / 2) + "{",
    b64url: "-_".repeat(N / 2),
    "b64 mix": "+-".repeat(N / 2),
    nul: "\u0000".repeat(N),
  };
  for (const [name, s] of Object.entries(inputs)) {
    assert.ok(s.length <= MAX_DECODE_CHARS, `${name} ${s.length}`);
    const t0 = performance.now();
    const r = decode(s);
    const ms = performance.now() - t0;
    assert.ok(ms < 1500, `${name} took ${ms.toFixed(0)} ms`);
    // The only inputs that may give something are the ones that really are what they look like.
    if (r && !["utm ×7000", "utm ×8000 + keep", "[["].includes(name)) assert.fail(`${name} gave ${r.kind}`);
  }
});

test("a text of just over 100 KB costs nothing at all", () => {
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) decode("a".repeat(MAX_DECODE_CHARS + 1));
  assert.ok(performance.now() - t0 < 200);
});

test("an ordinary copy costs microseconds", () => {
  const typical = [
    "Ship the smallest useful version, then learn from real behavior.",
    "npm run tauri dev",
    "https://github.com/microsoft/windows-rs",
    "SpringVector3NaturalMotionAnimation",
    "Hi Dina,\n\nThanks for the update. I'll send the report tomorrow.\n\nBest,\nAndrea",
  ];
  for (const s of typical) decode(s); // warm up
  const runs = 20_000;
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) for (const s of typical) decode(s);
  const each = ((performance.now() - t0) * 1000) / (runs * typical.length);
  assert.ok(each < 50, `${each.toFixed(1)} µs per text`);
});
