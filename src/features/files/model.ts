/*
 * The Files tool's model: the engine's catalog (src-tauri/src/pomelo_engine), which operations fit the files at hand, and a
 * run's state built from the engine's lines, file by file.
 */

export type FileTab = "convert" | "tools" | "actions";
export const FILE_TABS: FileTab[] = ["convert", "tools", "actions"];

export interface OpOption {
  id: string;
  type: "int" | "bool" | "choice" | "text";
  label: string;
  default: unknown;
  min?: number | null;
  max?: number | null;
  choices: { id: string; label: string }[];
}

export interface Op {
  id: string;
  tab: FileTab;
  name: string;
  kinds: string[];
  /** With their dot (".jpg"); none means any file. */
  extensions: string[];
  output: string | null;
  options: OpOption[];
  /** Joins all its files into one result (a merge, a ZIP); without it each file gives its own. */
  multi: boolean;
  /** Asks for a password. */
  secret: boolean;
}

export type RunLine =
  | { type: "start"; index: number; file: string }
  | { type: "progress"; index: number; fraction: number }
  | { type: "busy"; index: number; seconds: number }
  | { type: "done"; index: number; outputs: string[]; text?: string }
  /** Index -1: the operation does not fit these files, said before any file starts. */
  | { type: "error"; index: number; code: string; message: string }
  | { type: "allowance"; left: number }
  | { type: "end"; ok: number; failed: number; cancelled?: boolean }
  | { type: "locked"; left: number };

export interface License {
  state: "free" | "unlocked" | "not-configured";
  left?: number;
  daily?: number;
  email?: string | null;
  /** The payment page, when the engine knows one: Buy shows only then. */
  buy?: string;
  /** The price, in US dollars ("4.99"); with `was` and `until` a launch offer below the usual price, until that moment. */
  offer?: { price?: string; was?: string; until?: string };
}

/** The price the licence panel shows: an offer only with a real usual price and an end still ahead on this PC's clock. */
export interface Price {
  price: string;
  was?: string;
  until?: Date;
}

/** `offer` as the panel shows it at `now`; null without one (an older engine), which keeps the panel's own US$4.99. */
export function priceShown(offer: License["offer"], now: number): Price | null {
  const money = (s: unknown): s is string => typeof s === "string" && /^\d{1,4}\.\d{2}$/.test(s);
  if (!offer || !money(offer.price)) return null;
  const until = typeof offer.until === "string" ? new Date(offer.until) : null;
  // An invalid date gives NaN, which is never ahead.
  if (money(offer.was) && Number(offer.was) > Number(offer.price) && until && until.getTime() > now) return { price: offer.price, was: offer.was, until };
  return { price: offer.price };
}

/** A file's extension with its dot, in lower case ("" for none). */
export function extOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/**
 * The operations that take all of `paths`, by each file's extension. Every operation takes several files, done one by one;
 * `multi` only means it joins them into one result.
 */
export function compatible(ops: Op[], paths: string[]): Op[] {
  if (!paths.length) return [];
  return ops.filter((op) => !op.extensions.length || paths.every((p) => op.extensions.some((x) => x.toLowerCase() === extOf(p))));
}

/** The tabs that have an operation, in Convert, Tools, Actions order. */
export function tabsOf(ops: Op[]): FileTab[] {
  return FILE_TABS.filter((tab) => ops.some((op) => op.tab === tab));
}

/** An operation's options at their defaults, as the strings the engine takes. */
export function defaultValues(op: Op): Record<string, string> {
  const values: Record<string, string> = {};
  for (const o of op.options) {
    const d = o.default;
    if (o.type === "bool") values[o.id] = d === true ? "true" : "false";
    else if (o.type === "choice") values[o.id] = typeof d === "string" && o.choices.some((c) => c.id === d) ? d : (o.choices[0]?.id ?? "");
    else if (o.type === "int") values[o.id] = String(typeof d === "number" ? Math.round(d) : (o.min ?? 0));
    else values[o.id] = typeof d === "string" ? d : "";
  }
  return values;
}

export interface FileRun {
  path: string;
  status: "waiting" | "running" | "done" | "error";
  /** 0 to 1, null while the engine cannot tell. */
  fraction: number | null;
  outputs: string[];
  /** What an operation that writes no file gives back (a checksum, copied text). */
  text: string | null;
  error: { code: string; message: string } | null;
}

export interface RunState {
  files: FileRun[];
  /** Free files left without a licence, null with one (or before the engine says). */
  left: number | null;
  /** No licence and fewer free files left than asked for: nothing ran. */
  locked: boolean;
  /** The engine's own words when the operation does not fit the files at all. */
  problem: string | null;
  ended: boolean;
}

export function startRun(paths: string[]): RunState {
  return { files: paths.map((path) => ({ path, status: "waiting", fraction: 0, outputs: [], text: null, error: null })), left: null, locked: false, problem: null, ended: false };
}

/** The run after one of the engine's lines. */
export function step(state: RunState, line: RunLine): RunState {
  const file = (index: number, patch: Partial<FileRun>) =>
    index >= 0 && index < state.files.length ? { ...state, files: state.files.map((f, i) => (i === index ? { ...f, ...patch } : f)) } : state;
  switch (line.type) {
    case "start":
      return file(line.index, { status: "running", fraction: 0 });
    case "progress":
      return file(line.index, { status: "running", fraction: Math.max(0, Math.min(1, line.fraction)) });
    case "busy":
      return file(line.index, { status: "running", fraction: null });
    case "done":
      return file(line.index, { status: "done", fraction: 1, outputs: line.outputs ?? [], text: line.text ?? null });
    case "error":
      if (line.index < 0) return { ...state, problem: line.message || line.code, ended: true };
      return file(line.index, { status: "error", error: { code: line.code, message: line.message } });
    case "allowance":
      return { ...state, left: line.left };
    case "locked":
      return { ...state, locked: true, left: line.left, ended: true };
    case "end":
      return { ...state, ended: true };
  }
}

/** The outputs of the files that worked. */
export const outputsOf = (state: RunState): string[] => state.files.flatMap((f) => f.outputs);

/** The engine's code for the language Crest shows: Chinese is "zh-Hans" there; one it lacks falls back to English in the engine. */
export const engineLang = (lang: string): string => (lang === "zh-CN" ? "zh-Hans" : lang);
