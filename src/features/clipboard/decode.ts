// What is a copied text? JWT, Unix time, Base64, UUID, JSON, hex colour or a link with tracking, and what it decodes to.
// Pure and offline: nothing is stored, logged or sent. Every check is a plain scan or an anchored regex over one
// character class (no nested quantifiers), so a long odd text costs one pass, not a blow-up.

/** Texts longer than this are not looked at. */
export const MAX_DECODE_CHARS = 100_000;

export type Decoded =
  | { kind: "jwt"; header: string; payload: string; exp: number | null; expired: boolean; copy: string }
  | { kind: "time"; ms: number; unit: "s" | "ms"; copy: string }
  | { kind: "base64"; text: string; copy: string }
  | { kind: "uuid"; version: number | null; nil: boolean; copy: string }
  | { kind: "json"; pretty: string; copy: string }
  | { kind: "color"; hex: string; rgb: [number, number, number]; hsl: [number, number, number]; copy: string }
  | { kind: "tracking"; clean: string; removed: string[]; copy: string };

/** The first thing that fits, or null. `now` (ms) only decides whether a JWT has expired. */
export function decode(text: string, now = Date.now()): Decoded | null {
  if (text.length > MAX_DECODE_CHARS) return null;
  const s = text.trim();
  if (!s) return null;
  const first = s[0];
  // A GUID in braces starts like an object.
  if (first === "{" || first === "[") return json(s) ?? (first === "{" ? uuid(s) : null);
  if (first === "#") return color(s);
  // "Authorization: Bearer …" is copied as often as the bare token.
  const bearer = /^bearer\s+/i.exec(s);
  if (bearer) return jwt(s.slice(bearer[0].length), now);
  // Everything below is one token; anything with a space in it (prose, code) is not.
  if (/\s/.test(s)) return null;
  return time(s) ?? uuid(s) ?? jwt(s, now) ?? tracking(s) ?? base64(s);
}

// ---- JSON -----------------------------------------------------------------------------------------------------------

/** Valid JSON that is a non-empty object or array; a bare number or string, `{}` and `[]` are not worth a chip. */
function isContainer(s: string): boolean {
  const last = s[s.length - 1];
  if (last !== "}" && last !== "]") return false;
  try {
    const v: unknown = JSON.parse(s);
    return typeof v === "object" && v !== null && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0);
  } catch {
    return false;
  }
}

function json(s: string): Decoded | null {
  const pretty = isContainer(s) ? indentJson(s) : null;
  return pretty === null ? null : { kind: "json", pretty, copy: pretty };
}

/** Deeper than this is not a document anyone reads, and each level adds a line's worth of indent to every line below it. */
const MAX_JSON_DEPTH = 40;

/**
 * Re-indents VALID json text by scanning it, without parsing numbers: 9007199254740993 stays what it was,
 * key order and duplicate keys stay too (a parse and stringify would change all three). Null when nested too deep.
 */
export function indentJson(src: string): string | null {
  const pad = (n: number) => "  ".repeat(n);
  let out = "";
  let depth = 0;
  let inString = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      out += c;
      if (c === "\\") out += src[++i] ?? "";
      else if (c === '"') inString = false;
      continue;
    }
    switch (c) {
      case '"':
        inString = true;
        out += c;
        break;
      case "{":
      case "[": {
        let j = i + 1;
        while (j < src.length && /\s/.test(src[j])) j++;
        if (src[j] === (c === "{" ? "}" : "]")) {
          out += c + src[j];
          i = j;
        } else if (depth >= MAX_JSON_DEPTH) return null;
        else out += `${c}\n${pad(++depth)}`;
        break;
      }
      case "}":
      case "]":
        out += `\n${pad(--depth)}${c}`;
        break;
      case ",":
        out += `,\n${pad(depth)}`;
        break;
      case ":":
        out += ": ";
        break;
      default:
        if (!/\s/.test(c)) out += c;
    }
  }
  return out;
}

// ---- Base64 and JWT -------------------------------------------------------------------------------------------------

const NOT_TEXT = /(?![\t\n\r])[\p{Cc}\p{Cn}\p{Co}\p{Cs}]/u;

/** Base64 or base64url (with or without padding) → UTF-8 text without control characters, else null. */
function fromBase64(b64: string): string | null {
  try {
    const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    return NOT_TEXT.test(text) ? null : text;
  } catch {
    return null;
  }
}

function jsonObject(text: string | null): { value: Record<string, unknown>; text: string } | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? { value: value as Record<string, unknown>, text } : null;
  } catch {
    return null;
  }
}

const B64URL = /^[A-Za-z0-9_-]+$/;

/** Three base64url parts: a header with `alg` and a payload, both JSON objects, then the signature (empty for alg "none"). */
function jwt(s: string, now: number): Decoded | null {
  const a = s.indexOf(".");
  const b = s.indexOf(".", a + 1);
  if (a < 1 || b < 0 || b === a + 1 || s.indexOf(".", b + 1) >= 0) return null;
  const [h, p, sig] = [s.slice(0, a), s.slice(a + 1, b), s.slice(b + 1)];
  if (!B64URL.test(h) || !B64URL.test(p) || (sig && !B64URL.test(sig))) return null;
  const header = jsonObject(fromBase64(h));
  if (typeof header?.value.alg !== "string") return null;
  const payload = jsonObject(fromBase64(p));
  if (!payload) return null;
  const claim = payload.value.exp;
  const exp = typeof claim === "number" && Number.isFinite(new Date(claim * 1000).getTime()) ? claim * 1000 : null;
  const [hs, ps] = [indentJson(header.text), indentJson(payload.text)];
  if (hs === null || ps === null) return null;
  return { kind: "jwt", header: hs, payload: ps, exp, expired: exp !== null && now >= exp, copy: `${hs}\n\n${ps}` };
}

// Characters that run through ordinary text. `+ * % ^ ~ | $ ` and the like are what random bytes produce.
const ORDINARY = /[\p{L}\p{M}\p{N}\p{Extended_Pictographic}\s‍.,:;!?'"()[\]{}<>/\\@#&=_-]/gu;
const SHORT_TEXT = /^[A-Za-z0-9](?:[A-Za-z0-9 .:_@=-]*[A-Za-z0-9.])?\n?$/;
const NON_LATIN_LETTER = /[^\P{L}\p{Script=Latin}]/u;

/**
 * Does decoded Base64 read like something a person or a program wrote, not like the bytes of a word that happens to
 * be valid Base64 ("Installa" decodes to `"{-jYZ`)? Real JSON always passes. Otherwise at least 90 % of the
 * characters are ordinary, no word mixes Latin with another script, and under 12 bytes it must be plain ASCII
 * that starts with a letter or digit: six bytes carry too little to tell a text from noise.
 */
function plausible(d: string, bytes: number): boolean {
  if (isContainer(d)) return true;
  const sample = d.slice(0, 2000);
  if (sample.replace(ORDINARY, "").length > sample.length / 10) return false;
  if (/[^\x00-\x7f]/.test(sample)) {
    for (const [word] of sample.matchAll(/\p{L}+/gu)) if (/\p{Script=Latin}/u.test(word) && NON_LATIN_LETTER.test(word)) return false;
  }
  return bytes >= 12 || SHORT_TEXT.test(d);
}

/**
 * A token of standard or URL-safe Base64 that decodes to plausible text. Words and identifiers are valid Base64
 * too, so it is strict: at least 8 characters, a whole number of 4-character groups (shortcut: a base64url token
 * without padding and with a ragged end is not recognised), not all hex digits (hashes), not both alphabets.
 */
function base64(s: string): Decoded | null {
  if (s.length < 8 || s.length % 4 !== 0 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return null;
  if (/[+/]/.test(s) && /[-_]/.test(s)) return null;
  if (/^[0-9a-f]+$/i.test(s)) return null;
  const text = fromBase64(s);
  const bytes = (s.length / 4) * 3 - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0);
  return text === null || !plausible(text, bytes) ? null : { kind: "base64", text, copy: text };
}

// ---- Unix time --------------------------------------------------------------------------------------------------------

const YEAR_2000 = 946_684_800;
const YEAR_2100 = 4_102_444_800;

/** A whole number of seconds or milliseconds between 2000 and 2100 (phone and order numbers in that range look the same). */
function time(s: string): Decoded | null {
  if (s.length > 13 || !/^[1-9]\d+$/.test(s)) return null;
  const n = Number(s);
  if (n >= YEAR_2000 && n < YEAR_2100) return { kind: "time", ms: n * 1000, unit: "s", copy: new Date(n * 1000).toISOString() };
  if (n >= YEAR_2000 * 1000 && n < YEAR_2100 * 1000) return { kind: "time", ms: n, unit: "ms", copy: new Date(n).toISOString() };
  return null;
}

// ---- UUID -------------------------------------------------------------------------------------------------------------

const UUID = /^\{?([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\}?$/i;

/** 8-4-4-4-12 hex digits, also in the braces Windows writes GUIDs with. The version only counts for the standard variant. */
function uuid(s: string): Decoded | null {
  const m = UUID.exec(s);
  if (!m || s.startsWith("{") !== s.endsWith("}")) return null;
  const groups = m.slice(1);
  const plain = groups.join("-").toLowerCase();
  const version = Number.parseInt(groups[2][0], 16);
  const standard = "89ab".includes(groups[3][0].toLowerCase());
  return { kind: "uuid", version: standard && version >= 1 && version <= 8 ? version : null, nil: /^[0-]+$/.test(plain), copy: plain };
}

// ---- Colour -----------------------------------------------------------------------------------------------------------

/** #rgb or #rrggbb. "#123" and "#404" read as issue numbers, so a short code without a letter must be a grey (#000 to #999). */
function color(s: string): Decoded | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) {
    if (!/[a-f]/.test(h) && !(h[0] === h[1] && h[1] === h[2])) return null;
    h = [...h].map((c) => c + c).join("");
  }
  const rgb: [number, number, number] = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  return { kind: "color", hex: `#${h}`, rgb, hsl: hsl(rgb), copy: `rgb(${rgb.join(", ")})` };
}

function hsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [x, y, z] = [r / 255, g / 255, b / 255];
  const max = Math.max(x, y, z);
  const min = Math.min(x, y, z);
  const d = max - min;
  const l = (max + min) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) h = max === x ? ((y - z) / d + 6) % 6 : max === y ? (z - x) / d + 2 : (x - y) / d + 4;
  return [Math.round(h * 60) % 360, Math.round(sat * 100), Math.round(l * 100)];
}

// ---- Tracking parameters ------------------------------------------------------------------------------------------

const TRACKING_PARAMS = new Set(["fbclid", "gclid", "gbraid", "wbraid", "dclid", "msclkid", "twclid", "ttclid", "yclid", "igshid", "mc_cid", "mc_eid"]);

const isTracking = (name: string) => TRACKING_PARAMS.has(name.toLowerCase()) || /^utm_\w+$/i.test(name);

/**
 * A link or path whose query carries utm_*, fbclid, gclid and the like. The rest of the text is kept character for
 * character (no URL parsing, which would re-encode it): only those parameters are cut.
 */
function tracking(s: string): Decoded | null {
  const q = s.indexOf("?");
  if (q < 1) return null;
  const base = s.slice(0, q);
  // A link, a path, or a host with a path: not a lone word before the question mark.
  if (!/^[a-z][a-z0-9+.-]*:\/\/./i.test(base) && !/[/.]/.test(base)) return null;
  const hash = s.indexOf("#");
  // A "?" after the "#" belongs to the page's own route, not to the link.
  if (hash >= 0 && hash < q) return null;
  const end = hash < 0 ? s.length : hash;
  const params = s.slice(q + 1, end).split("&");
  const nameOf = (p: string) => p.split("=", 1)[0];
  const kept = params.filter((p) => !isTracking(nameOf(p)));
  if (kept.length === params.length) return null;
  const removed = params.filter((p) => isTracking(nameOf(p))).map(nameOf);
  const clean = base + (kept.length ? `?${kept.join("&")}` : "") + s.slice(end);
  return { kind: "tracking", clean, removed, copy: clean };
}
