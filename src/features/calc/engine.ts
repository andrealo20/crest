import { CURRENCIES, SYMBOL_CURRENCY, convertUnits, findUnit, type UnitDef } from "./units.ts";

/*
 * Calc's engine: one line of text in, one value or one error out. A hand-written lexer and recursive-descent parser
 * that evaluates as it reads (no eval, no Function, no dependencies). Nothing here touches the DOM, the language or
 * the network: the clock and the exchange rates come in through `Options`, so the tests can pin them.
 *
 * Errors are `CalcError`s with a stable code and values for the message; `messages.ts` turns them into text.
 * A line never throws out of `evaluate`: anything unexpected comes back as an error row.
 */

/** Longest line, in characters. A longer one is an error and is not read. */
export const MAX_LINE = 200;
/** Lines beyond this are not evaluated. */
export const MAX_LINES = 500;
/** Nesting of parentheses, minus signs and exponents; the line limit alone would still allow a deep recursion. */
const MAX_DEPTH = 40;
const MAX_ARGS = 20;
const DAY_MS = 86_400_000;

export type Value =
  | { k: "num"; v: number }
  /** A percentage as a fraction: 15% is 0.15. */
  | { k: "pct"; v: number }
  | { k: "qty"; v: number; u: UnitDef }
  | { k: "money"; v: number; c: string }
  /** `t` is epoch milliseconds; `time` says the value has a time of day (now, or a date plus hours), not just a day. */
  | { k: "date"; t: number; time: boolean };

export type Vars = Record<string, string | number>;

export class CalcError extends Error {
  code: string;
  vars: Vars;
  constructor(code: string, vars: Vars = {}) {
    super(code);
    this.code = code;
    this.vars = vars;
  }
}

export type LineResult = { kind: "empty" } | { kind: "value"; value: Value } | { kind: "error"; code: string; vars: Vars };

export interface Evaluation {
  lines: LineResult[];
  /** Some line names a currency: the caller loads exchange rates only then. */
  usesMoney: boolean;
}

export interface Options {
  /** The clock, once per evaluation. */
  now?: Date;
  /** `amount` of `from` in `to`: undefined while rates are not loaded, and returns null for a currency without a rate. */
  money?: (amount: number, from: string, to: string) => number | null;
}

// ---------- Lexer ----------

interface Tok {
  t: "num" | "id" | "op" | "date" | "cur" | "end";
  /** The text as typed, for messages and unit names; an operator spelled as a word or sign is its plain form ("*", "mod"). */
  s: string;
  v?: number;
  d?: [number, number, number];
}

const CONVERT = new Set(["in", "to", "as", "into"]);
const WORD_OPS: Record<string, string> = { plus: "+", minus: "-", times: "*", mod: "mod" };
const SIGNS: Record<string, string> = { "×": "*", "÷": "/", "−": "-" };
const FUNCS: Record<string, [number, number]> = {
  sqrt: [1, 1], abs: [1, 1], round: [1, 2], floor: [1, 1], ceil: [1, 1], min: [1, MAX_ARGS], max: [1, MAX_ARGS],
  log: [1, 1], ln: [1, 1], sin: [1, 1], cos: [1, 1], tan: [1, 1], asin: [1, 1], acos: [1, 1], atan: [1, 1], pow: [2, 2],
};
const RESERVED = new Set([...Object.keys(FUNCS), ...CONVERT, ...Object.keys(WORD_OPS), "of", "until", "since", "divided", "by", "pi", "π", "e", "ans", "above", "today", "now", "tomorrow", "yesterday"]);
/** A word after a percent sign that does not start an operand, so the sign is a percentage and not a remainder. */
const NOT_AN_OPERAND = new Set([...CONVERT, "of", "until", "since", "by"]);

/** Own keys only: "constructor" and the like are no operator, function or currency symbol. */
const own = <T,>(o: Record<string, T>, k: string): T | undefined => (Object.hasOwn(o, k) ? o[k] : undefined);

const WORD = /^[\p{L}_°][\p{L}\p{N}_°]*/u;

/** A number at the start of `rest`: [length, value], or null. Grouping marks follow the Converter's reading ("1,000" groups, "1,5" is a decimal). */
function readNumber(rest: string, inCall: boolean): [number, number] | null {
  let m: RegExpExecArray | null;
  // Inside f(…) a comma separates arguments, so "max(1,200)" is two numbers.
  if (!inCall) {
    if ((m = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)/.exec(rest))) return [m[0].length, Number(m[0].replaceAll(",", ""))];
    if ((m = /^\d{1,3}(?:\.\d{3})+,\d+(?!\d)/.exec(rest))) return [m[0].length, Number(m[0].replaceAll(".", "").replace(",", "."))];
    if ((m = /^\d{1,3}(?:\.\d{3}){2,}(?!\d)/.exec(rest))) return [m[0].length, Number(m[0].replaceAll(".", ""))];
    if ((m = /^\d+,\d{1,2}(?!\d)/.exec(rest))) return [m[0].length, Number(m[0].replace(",", "."))];
  }
  if ((m = /^\d{1,3}(?:[   ]\d{3})+(?:\.\d+)?(?!\d)/.exec(rest))) return [m[0].length, Number(m[0].replace(/[   ]/g, ""))];
  if ((m = /^(?:\d+(?:_\d+)*(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest))) return [m[0].length, Number(m[0].replaceAll("_", ""))];
  return null;
}

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  /** Per open parenthesis: does it belong to a function call? */
  const calls: boolean[] = [];
  let pos = 0;
  while (pos < src.length) {
    const ch = src[pos];
    if (/\s/.test(ch)) {
      pos++;
      continue;
    }
    if (ch === "#" || src.startsWith("//", pos)) break;
    const rest = src.slice(pos);
    const prev = toks[toks.length - 1];
    let m: RegExpExecArray | null;
    if ((m = /^\d{4}-\d{2}-\d{2}(?!\d)/.exec(rest))) {
      const [y, mo, d] = m[0].split("-").map(Number);
      if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > new Date(y, mo, 0).getDate()) throw new CalcError("date", { s: m[0] });
      toks.push({ t: "date", s: m[0], d: [y, mo, d] });
      pos += m[0].length;
    } else if (/\d/.test(ch) || (ch === "." && /\d/.test(src[pos + 1] ?? ""))) {
      const n = readNumber(rest, calls[calls.length - 1] === true);
      if (!n || !Number.isFinite(n[1])) throw new CalcError("bignum");
      toks.push({ t: "num", s: rest.slice(0, n[0]), v: n[1] });
      pos += n[0];
    } else if (own(SYMBOL_CURRENCY, ch)) {
      toks.push({ t: "cur", s: ch });
      pos++;
    } else if ((m = /^divided\s+by(?![\p{L}\p{N}_])/iu.exec(rest))) {
      toks.push({ t: "op", s: "/" });
      pos += m[0].length;
    } else if (
      (prev?.t === "num" || (prev?.t === "op" && prev.s === ")") || (prev?.t === "id" && CONVERT.has(prev.s.toLowerCase()))) &&
      (m = /^(?:km\/h|m\/s)(?![\p{L}\p{N}_])/iu.exec(rest))
    ) {
      toks.push({ t: "id", s: m[0].toLowerCase() });
      pos += m[0].length;
    } else if ((m = WORD.exec(rest))) {
      const op = own(WORD_OPS, m[0].toLowerCase());
      toks.push(op ? { t: "op", s: op } : { t: "id", s: m[0] });
      pos += m[0].length;
    } else if (rest.startsWith("**")) {
      toks.push({ t: "op", s: "^" });
      pos += 2;
    } else if ("+-*/^%(),=".includes(ch) || own(SIGNS, ch)) {
      if (ch === "(") calls.push(prev?.t === "id");
      else if (ch === ")") calls.pop();
      toks.push({ t: "op", s: own(SIGNS, ch) ?? ch });
      pos++;
    } else {
      throw new CalcError("chars", { s: ch });
    }
  }
  toks.push({ t: "end", s: "" });
  return toks;
}

// ---------- Values ----------

const mag = (v: Value): number => (v.k === "date" ? v.t : v.v);
const isUnit = (v: Value): v is Extract<Value, { k: "qty" | "money" }> => v.k === "qty" || v.k === "money";

/** A numeric result must be a real number: no NaN, no Infinity. */
function ok(v: Value): Value {
  if (!Number.isFinite(mag(v))) throw new CalcError("range");
  return v;
}

const num = (v: number): Value => ok({ k: "num", v });

function scale(v: Value, f: number): Value {
  if (v.k === "date") throw new CalcError("dateOp");
  return ok({ ...v, v: v.v * f });
}

/** The same value with a plain number, or an error when it carries a unit, a percent sign or is a date. */
function plain(v: Value): number {
  if (v.k !== "num") throw new CalcError("plain");
  return v.v;
}

const dayNumber = (t: number): number => {
  const d = new Date(t);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS;
};

function addMonths(d: Date, n: number): void {
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
}

/** `d` plus `s` times `q` (a time): days, weeks, months and years move on the calendar, the rest by the clock. */
function addTime(d: Extract<Value, { k: "date" }>, q: Extract<Value, { k: "qty" }>, s: 1 | -1): Value {
  const n = s * q.v;
  const at = new Date(d.t);
  let time = d.time;
  let rest = 0; // milliseconds left over after the calendar part
  const id = q.u.id;
  if (id === "d" || id === "wk") {
    const days = id === "wk" ? n * 7 : n;
    const whole = Math.trunc(days);
    at.setDate(at.getDate() + whole);
    rest = (days - whole) * DAY_MS;
  } else if (id === "mo" || id === "yr") {
    const months = id === "yr" ? n * 12 : n;
    const whole = Math.trunc(months);
    addMonths(at, whole);
    rest = (months - whole) * 2_629_800_000;
  } else {
    rest = n * q.u.factor * 1000;
    time = true;
  }
  if (rest) time = true;
  const t = at.getTime() + Math.round(rest);
  if (!Number.isFinite(t) || Number.isNaN(new Date(t).getTime())) throw new CalcError("range");
  return { k: "date", t, time };
}

// ---------- Evaluation ----------

interface Ctx {
  vars: Map<string, Value>;
  ans: Value | null;
  above: Value | null;
  now: Date;
  money?: Options["money"];
  usesMoney: boolean;
}

function evalTokens(toks: Tok[], ctx: Ctx): Value {
  let i = 0;
  let depth = 0;
  const peek = () => toks[i];
  const isOp = (tk: Tok, s: string) => tk.t === "op" && tk.s === s;
  const word = (tk: Tok) => (tk.t === "id" ? tk.s.toLowerCase() : "");
  const enter = () => {
    if (++depth > MAX_DEPTH) throw new CalcError("depth");
  };

  const curCode = (name: string) => (CURRENCIES.has(name.toUpperCase()) ? name.toUpperCase() : undefined);

  /** `c` the amount `b` is in, as an amount of currency `to`. */
  function toCurrency(b: Extract<Value, { k: "money" }>, to: string): number {
    if (b.c === to) return b.v;
    if (!ctx.money) throw new CalcError("rates");
    ctx.usesMoney = true;
    const r = ctx.money(b.v, b.c, to);
    if (r === null) throw new CalcError("noRate", { a: b.c, b: to });
    return r;
  }

  /** `b` written in the unit of `a`, when the two can be compared or added. */
  function inUnitOf(a: Value, b: Value): number {
    if (a.k === "num" && b.k === "num") return b.v;
    if (a.k === "pct" && b.k === "pct") return b.v;
    if (a.k === "qty" && b.k === "qty" && a.u.cat === b.u.cat) return convertUnits(b.v, b.u, a.u);
    if (a.k === "money" && b.k === "money") return toCurrency(b, a.c);
    if (a.k === "date" && b.k === "date") return b.t;
    throw new CalcError("combine");
  }

  function add(a: Value, b: Value, s: 1 | -1): Value {
    if (a.k === "date" || b.k === "date") {
      if (a.k === "date" && b.k === "date") {
        if (s === 1) throw new CalcError("dateOp");
        const days = !a.time && !b.time ? dayNumber(a.t) - dayNumber(b.t) : (a.t - b.t) / DAY_MS;
        return ok({ k: "qty", v: days, u: findUnit("d")! });
      }
      const [d, q] = a.k === "date" ? [a, b] : [b, a];
      // A date is on the left of a minus, or either side of a plus.
      if (d.k !== "date" || q.k !== "qty" || q.u.cat !== "time" || (s === -1 && b.k === "date")) throw new CalcError("dateOp");
      return addTime(d, q, s);
    }
    // 100 + 15% is 15% of the left side, not 0.15 more.
    if (b.k === "pct" && a.k !== "pct") return scale(a, 1 + s * b.v);
    if (a.k === "qty" && b.k === "qty" && a.u.cat === "temp" && a.u.cat === b.u.cat) throw new CalcError("temp");
    if (a.k === "pct" && b.k !== "pct") throw new CalcError("combine");
    const r = inUnitOf(a, b);
    return ok({ ...a, v: a.v + s * r } as Value);
  }

  function mul(a: Value, b: Value): Value {
    if (a.k === "date" || b.k === "date") throw new CalcError("dateOp");
    if (isUnit(a) && isUnit(b)) throw new CalcError("twoUnits");
    const v = a.v * b.v;
    if (isUnit(a)) return ok({ ...a, v });
    if (isUnit(b)) return ok({ ...b, v });
    return ok({ k: a.k === "pct" && b.k === "pct" ? "pct" : "num", v });
  }

  function div(a: Value, b: Value): Value {
    if (a.k === "date" || b.k === "date") throw new CalcError("dateOp");
    if (b.v === 0) throw new CalcError("div0");
    if (isUnit(b)) {
      if (a.k === "qty" && b.k === "qty" && a.u.cat === b.u.cat && a.u.cat !== "temp") return num(a.v / convertUnits(b.v, b.u, a.u));
      if (a.k === "money" && b.k === "money") return num(a.v / toCurrency(b, a.c));
      throw new CalcError(isUnit(a) ? "combine" : "unitDiv");
    }
    const v = a.v / b.v;
    if (isUnit(a)) return ok({ ...a, v });
    return ok({ k: a.k === "pct" && b.k !== "pct" ? "pct" : "num", v });
  }

  function pow(a: Value, b: Value): Value {
    const x = plain(a), y = plain(b);
    if (x === 0 && y < 0) throw new CalcError("div0");
    return num(x ** y);
  }

  function neg(v: Value): Value {
    if (v.k === "date") throw new CalcError("dateOp");
    return { ...v, v: -v.v };
  }

  function convertTo(left: Value, target: UnitDef | string): Value {
    if (left.k === "num") throw new CalcError("noUnit");
    if (left.k === "pct" || left.k === "date") throw new CalcError("noConvert");
    const to = typeof target === "string" ? target : target.symbol;
    if (typeof target === "string") {
      if (left.k !== "money") throw new CalcError("mismatch", { a: left.u.symbol, b: to });
      return { k: "money", c: target, v: toCurrency(left, target) };
    }
    if (left.k !== "qty" || left.u.cat !== target.cat) throw new CalcError("mismatch", { a: left.k === "qty" ? left.u.symbol : left.c, b: to });
    return ok({ k: "qty", u: target, v: convertUnits(left.v, left.u, target) });
  }

  /** The unit or currency a word at position `at` names when it follows a number, else null. */
  function unitAt(at: number): UnitDef | string | null {
    const tk = toks[at];
    if (tk.t !== "id") return null;
    const low = tk.s.toLowerCase();
    // "5 in cm" means a conversion with nothing to convert; "12 in in cm" is twelve inches.
    if (low === "in") {
      const n = toks[at + 1];
      if (n.t === "id" && n.s.toLowerCase() !== "in" && (findUnit(n.s) || curCode(n.s))) return null;
    }
    return findUnit(tk.s) ?? curCode(tk.s) ?? null;
  }

  function startsOperand(tk: Tok): boolean {
    if (tk.t === "num" || tk.t === "date" || tk.t === "cur") return true;
    if (tk.t === "id") return !NOT_AN_OPERAND.has(tk.s.toLowerCase());
    return isOp(tk, "(");
  }

  // ----- Functions -----

  function roundTo(x: number, digits: number): number {
    const f = 10 ** digits;
    return (Math.sign(x) * Math.round(Number((Math.abs(x) * f).toPrecision(15)))) / f;
  }

  function onNumber(v: Value, fn: (x: number) => number): Value {
    if (v.k === "num" || v.k === "qty" || v.k === "money") return ok({ ...v, v: fn(v.v) });
    throw new CalcError("plain");
  }

  /** An angle in radians; a bare number is refused so degrees and radians are never guessed. */
  function radians(v: Value): number {
    if (v.k !== "qty" || v.u.cat !== "angle") throw new CalcError("angle");
    return convertUnits(v.v, v.u, findUnit("rad")!);
  }

  const snap = (x: number) => (Math.abs(x) < 1e-15 ? 0 : x);
  const angle = (r: number): Value => ok({ k: "qty", v: r, u: findUnit("rad")! });

  function call(name: string, a: Value[]): Value {
    switch (name) {
      case "sqrt": {
        const x = plain(a[0]);
        if (x < 0) throw new CalcError("domain", { f: name });
        return num(Math.sqrt(x));
      }
      case "abs": return onNumber(a[0], Math.abs);
      case "floor": return onNumber(a[0], Math.floor);
      case "ceil": return onNumber(a[0], Math.ceil);
      case "round": {
        const digits = a[1] ? plain(a[1]) : 0;
        if (!Number.isInteger(digits) || digits < 0 || digits > 15) throw new CalcError("domain", { f: name });
        return onNumber(a[0], (x) => roundTo(x, digits));
      }
      case "min":
      case "max": {
        let best = a[0];
        for (const v of a.slice(1)) {
          const r = inUnitOf(best, v);
          if (name === "min" ? r < mag(best) : r > mag(best)) best = v;
        }
        return best;
      }
      case "log":
      case "ln": {
        const x = plain(a[0]);
        if (x <= 0) throw new CalcError("domain", { f: name });
        return num(name === "log" ? Math.log10(x) : Math.log(x));
      }
      case "sin": return num(snap(Math.sin(radians(a[0]))));
      case "cos": return num(snap(Math.cos(radians(a[0]))));
      case "tan": {
        const r = radians(a[0]);
        if (Math.abs(Math.cos(r)) < 1e-15) throw new CalcError("domain", { f: name });
        return num(snap(Math.tan(r)));
      }
      case "asin":
      case "acos": {
        const x = plain(a[0]);
        if (x < -1 || x > 1) throw new CalcError("domain", { f: name });
        return angle(name === "asin" ? Math.asin(x) : Math.acos(x));
      }
      case "atan": return angle(Math.atan(plain(a[0])));
      default: return pow(a[0], a[1]); // pow
    }
  }

  // ----- Grammar -----

  /** Adds, subtracts and converts (`in`), left to right, so "120 GBP in EUR - 15%" converts first and then takes the 15%. */
  function additive(allowConvert = true): Value {
    let left = term();
    for (;;) {
      const tk = peek();
      if (tk.t === "op" && (tk.s === "+" || tk.s === "-")) {
        i++;
        left = add(left, term(), tk.s === "+" ? 1 : -1);
      } else if (allowConvert && CONVERT.has(word(tk))) {
        i++;
        const name = peek();
        if (name.t !== "id") throw new CalcError(name.t === "end" ? "incomplete" : "unit", { s: name.s });
        const target = findUnit(name.s) ?? curCode(name.s);
        if (!target) throw new CalcError("unit", { s: name.s });
        i++;
        left = convertTo(left, target);
      } else {
        return left;
      }
    }
  }

  function term(): Value {
    let left = unary();
    for (;;) {
      const tk = peek();
      if (tk.t === "op" && (tk.s === "*" || tk.s === "/" || tk.s === "mod" || tk.s === "%")) {
        i++;
        const right = unary();
        if (tk.s === "*") left = mul(left, right);
        else if (tk.s === "/") left = div(left, right);
        else {
          const y = plain(right);
          if (y === 0) throw new CalcError("div0");
          left = num(plain(left) % y);
        }
      } else if (word(tk) === "of") {
        i++;
        const right = unary();
        if (left.k !== "pct") throw new CalcError("of");
        left = scale(right, left.v);
      } else {
        return left;
      }
    }
  }

  function unary(): Value {
    const tk = peek();
    if (tk.t === "op" && (tk.s === "-" || tk.s === "+")) {
      enter();
      i++;
      const v = unary();
      depth--;
      return tk.s === "-" ? neg(v) : v;
    }
    return power();
  }

  function power(): Value {
    const base = postfix();
    if (isOp(peek(), "^")) {
      i++;
      enter();
      const exp = unary();
      depth--;
      return pow(base, exp);
    }
    return base;
  }

  /** A value, then at most one unit ("5 km") and one percent sign ("15%"). */
  function postfix(): Value {
    let v = primary();
    if (v.k === "num") {
      const unit = unitAt(i);
      if (unit) {
        i++;
        if (typeof unit === "string") {
          ctx.usesMoney = true;
          v = { k: "money", c: unit, v: v.v };
        } else {
          v = { k: "qty", u: unit, v: v.v };
        }
      }
    }
    if (isOp(peek(), "%") && !startsOperand(toks[i + 1])) {
      if (v.k !== "num") throw new CalcError("pctPos");
      i++;
      v = { k: "pct", v: v.v / 100 };
    }
    return v;
  }

  function args(): Value[] {
    const list: Value[] = [];
    if (isOp(peek(), ")")) {
      i++;
      return list;
    }
    for (;;) {
      list.push(additive());
      if (isOp(peek(), ",")) {
        i++;
        if (list.length >= MAX_ARGS) throw new CalcError("argCount", { f: "" });
        continue;
      }
      if (!isOp(peek(), ")")) throw new CalcError(peek().t === "end" ? "paren" : "unexpected", { s: peek().s });
      i++;
      return list;
    }
  }

  function dateAtMidnight([y, m, d]: [number, number, number]): Value {
    const at = new Date(2000, 0, 1);
    at.setFullYear(y, m - 1, d);
    at.setHours(0, 0, 0, 0);
    return { k: "date", t: at.getTime(), time: false };
  }

  function today(shift = 0): Value {
    const at = new Date(ctx.now);
    at.setHours(0, 0, 0, 0);
    at.setDate(at.getDate() + shift);
    return { k: "date", t: at.getTime(), time: false };
  }

  function named(tk: Tok): Value {
    const low = tk.s.toLowerCase();
    if (own(FUNCS, low)) {
      if (!isOp(peek(), "(")) throw new CalcError("needParen", { f: low });
      i++;
      enter();
      const list = args();
      depth--;
      const [min, max] = FUNCS[low];
      if (list.length < min || list.length > max) throw new CalcError("argCount", { f: low });
      return call(low, list);
    }
    switch (low) {
      case "pi":
      case "π": return { k: "num", v: Math.PI };
      case "e": return { k: "num", v: Math.E };
      case "today": return today();
      case "tomorrow": return today(1);
      case "yesterday": return today(-1);
      case "now": return { k: "date", t: ctx.now.getTime(), time: true };
      case "ans":
        if (!ctx.ans) throw new CalcError("noAns");
        return ctx.ans;
      case "above":
        if (!ctx.above) throw new CalcError("noAbove");
        return ctx.above;
    }
    // "days until 2026-12-25", "weeks since 2026-01-01".
    const def = findUnit(tk.s);
    const dir = word(peek()) === "until" ? 1 : word(peek()) === "since" ? -1 : 0;
    if (def?.cat === "time" && dir) {
      i++;
      const target = additive(false);
      if (target.k !== "date") throw new CalcError("span");
      if (!target.time && (def.id === "d" || def.id === "wk")) {
        const days = dir * (dayNumber(target.t) - dayNumber(ctx.now.getTime()));
        return ok({ k: "qty", u: def, v: def.id === "wk" ? days / 7 : days });
      }
      return ok({ k: "qty", u: def, v: (dir * (target.t - ctx.now.getTime())) / (def.factor * 1000) });
    }
    const v = ctx.vars.get(low);
    if (v) return v;
    if (def || curCode(tk.s)) throw new CalcError("needNumber", { s: tk.s });
    throw new CalcError("name", { s: tk.s });
  }

  function primary(): Value {
    const tk = toks[i++];
    switch (tk.t) {
      case "num": return { k: "num", v: tk.v! };
      case "date": return dateAtMidnight(tk.d!);
      case "cur": {
        const v = primary();
        if (v.k !== "num") throw new CalcError("unexpected", { s: tk.s });
        ctx.usesMoney = true;
        return { k: "money", c: SYMBOL_CURRENCY[tk.s], v: v.v };
      }
      case "id": return named(tk);
      case "op":
        if (tk.s === "(") {
          enter();
          const v = additive();
          depth--;
          if (!isOp(peek(), ")")) throw new CalcError(peek().t === "end" ? "paren" : "unexpected", { s: peek().s });
          i++;
          return v;
        }
        throw new CalcError(tk.s === ")" ? "paren" : "unexpected", { s: tk.s });
      default:
        throw new CalcError("incomplete");
    }
  }

  // ----- A line -----

  let assigned: string | undefined;
  if (toks[0].t === "id" && isOp(toks[1], "=")) {
    assigned = toks[0].s.toLowerCase();
    if (RESERVED.has(assigned)) throw new CalcError("reserved", { s: toks[0].s });
    i = 2;
  }
  const value = additive();
  const tk = peek();
  if (tk.t !== "end") throw new CalcError(tk.t === "op" && tk.s === ")" ? "paren" : "unexpected", { s: tk.s });
  if (assigned) ctx.vars.set(assigned, value);
  return value;
}

/** "what is 15% of 60?" is "15% of 60": the question words and the closing mark are dropped. */
const tidy = (src: string) => {
  const line = src.replace(/^\s*what(?:'s|s|\s+is)\s+/i, "").replace(/\s*\?+\s*$/, "");
  // "2 + 3 =" asks for the answer; "x =" is an assignment that is not finished.
  return /^\s*[\p{L}_][\p{L}\p{N}_]*\s*=\s*$/u.test(line) ? line : line.replace(/\s*=+\s*$/, "");
};

function evalLine(src: string, ctx: Ctx): LineResult {
  if (src.length > MAX_LINE) return { kind: "error", code: "long", vars: { n: MAX_LINE } };
  try {
    const line = tidy(src);
    // A heading such as "Trip:" is text, not a calculation.
    if (/:\s*$/.test(line)) return { kind: "empty" };
    const toks = lex(line);
    if (toks.length === 1) return { kind: "empty" };
    return { kind: "value", value: evalTokens(toks, ctx) };
  } catch (e) {
    if (e instanceof CalcError) return { kind: "error", code: e.code, vars: e.vars };
    // A stack overflow or anything the grammar did not foresee still comes back as a row, never as a crash.
    return { kind: "error", code: e instanceof RangeError ? "depth" : "internal", vars: {} };
  }
}

/** Every line of `text`, top to bottom: variables, `ans` and `above` look only at the lines before. */
export function evaluate(text: string, opts: Options = {}): Evaluation {
  const ctx: Ctx = { vars: new Map(), ans: null, above: null, now: opts.now ?? new Date(), money: opts.money, usesMoney: false };
  const lines = text.split(/\r\n|\r|\n/).map((src, n): LineResult => {
    const res: LineResult = n >= MAX_LINES ? (src.trim() ? { kind: "error", code: "tooMany", vars: { n: MAX_LINES } } : { kind: "empty" }) : evalLine(src, ctx);
    ctx.above = res.kind === "value" ? res.value : null;
    if (res.kind === "value") ctx.ans = res.value;
    return res;
  });
  return { lines, usesMoney: ctx.usesMoney };
}
