/*
 * The Pomelo scope's model: the settings schema the engine prints (`pomelo-engine.exe settings schema`, src-tauri/src/pomelo_engine/
 * wheel.rs), checked and drawn with Crest's own controls, which rows show (`visibleIf`), and the wheel's states.
 */

export type RowType = "bool" | "int" | "choice" | "text" | "keys" | "list" | "custom";
const ROW_TYPES: readonly string[] = ["bool", "int", "choice", "text", "keys", "list", "custom"];

export interface SchemaRow {
  key: string;
  type: RowType;
  label: string;
  hint?: string;
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  choices?: { id: string; label: string }[];
  /** A `keys` row: its parts (Pomelo's three tabs), each set to one of `choices`; the value is `{ <part>: <choice> }`. */
  parts?: { id: string; label: string }[];
  /** `equals` is a value, or an array of values any of which shows the row. */
  visibleIf?: { key: string; equals: unknown };
  /** A `custom` row (`action: "open-settings"`): the page of Pomelo's own settings window that edits it. */
  page?: string;
}

export interface SchemaGroup {
  title?: string;
  rows: SchemaRow[];
}

export interface SchemaPage {
  id: string;
  title: string;
  icon?: string;
  groups: SchemaGroup[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A page id that is also a settings section (`pomelo-<id>`, wheel.rs page_ok). */
export const pageIdOk = (id: string) => /^[a-z0-9-]{1,32}$/.test(id);

function parseRow(v: unknown): SchemaRow | null {
  if (!isObject(v)) return null;
  const key = str(v.key), type = str(v.type), label = str(v.label);
  if (!key || !type || !ROW_TYPES.includes(type) || !label) return null;
  const labels = (list: unknown) =>
    Array.isArray(list) ? list.filter(isObject).flatMap((c) => (typeof c.id === "string" && typeof c.label === "string" ? [{ id: c.id, label: c.label }] : [])) : undefined;
  const choices = labels(v.choices), parts = labels(v.parts);
  if ((type === "choice" || type === "keys") && !choices?.length) return null;
  if (type === "keys" && !parts?.length) return null;
  const visibleIf = isObject(v.visibleIf) && typeof v.visibleIf.key === "string" ? { key: v.visibleIf.key, equals: v.visibleIf.equals } : undefined;
  // Only a page Pomelo's window has, with an id that makes a command line argument and nothing more.
  const page = v.action === "open-settings" && typeof v.page === "string" && pageIdOk(v.page) ? v.page : undefined;
  return { key, type: type as RowType, label, hint: str(v.hint), default: v.default, min: num(v.min), max: num(v.max), step: num(v.step), choices, parts, visibleIf, page };
}

/** The pages of the engine's answer that Crest can draw; a row it cannot read is left out, the rest stays. */
export function parseSchema(answer: unknown): SchemaPage[] {
  if (!isObject(answer) || !Array.isArray(answer.pages)) return [];
  return answer.pages.filter(isObject).flatMap((p) => {
    const id = str(p.id), title = str(p.title);
    if (!id || !pageIdOk(id) || !title || !Array.isArray(p.groups)) return [];
    const groups = p.groups.filter(isObject).map((g) => ({ title: str(g.title), rows: (Array.isArray(g.rows) ? g.rows : []).map(parseRow).filter((r): r is SchemaRow => r !== null) }));
    return [{ id, title, icon: str(p.icon), groups: groups.filter((g) => g.rows.length) }];
  });
}

/** The values of `settings get`, a flat object by key. */
export function valuesOf(answer: unknown): Record<string, unknown> {
  return isObject(answer) ? answer : {};
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** A row's value: the one saved, else the schema's default. */
export function valueOf(row: SchemaRow, values: Record<string, unknown>): unknown {
  return row.key in values ? values[row.key] : row.default;
}

/** Whether a row shows: without `visibleIf` always, else when the other setting (saved, else its default) equals the value named, or
 * one of them when `equals` is an array. */
export function visible(row: SchemaRow, values: Record<string, unknown>, defaults: Record<string, unknown>): boolean {
  if (!row.visibleIf) return true;
  const { key, equals } = row.visibleIf;
  const current = key in values ? values[key] : defaults[key];
  return Array.isArray(equals) ? equals.some((e) => same(current, e)) : same(current, equals);
}

/** The defaults of every row of the schema, for the `visibleIf` of a key no value was saved for. */
export function defaultsOf(pages: SchemaPage[]): Record<string, unknown> {
  return Object.fromEntries(pages.flatMap((p) => p.groups.flatMap((g) => g.rows.map((r) => [r.key, r.default]))));
}

export type Control = "switch" | "slider" | "number" | "segmented" | "select" | "text" | "list" | "keys" | "button";

/** The Crest control a row is drawn with. */
export function controlOf(row: SchemaRow): Control {
  switch (row.type) {
    case "bool":
      return "switch";
    case "int": {
      // A slider only for a range it can step through; a wide one is typed.
      const { min, max } = row;
      return min !== undefined && max !== undefined && max > min && (max - min) / (row.step ?? 1) <= 500 ? "slider" : "number";
    }
    case "choice":
      return (row.choices?.length ?? 0) <= 3 && row.choices!.every((c) => c.label.length <= 12) ? "segmented" : "select";
    case "list":
      return "list";
    case "keys":
      return "keys";
    case "custom":
      return "button";
    default:
      return "text";
  }
}

/** A typed number, as the row takes it: a whole number inside its range, else undefined. */
export function parseWhole(row: SchemaRow, text: string): number | undefined {
  if (!/^-?\d+$/.test(text.trim())) return undefined;
  const n = Number(text.trim());
  return (row.min === undefined || n >= row.min) && (row.max === undefined || n <= row.max) ? n : undefined;
}

/** A list setting as text, one item per comma, and back. */
export const listText = (v: unknown) => (Array.isArray(v) ? v.map(String).join(", ") : "");
export const parseList = (text: string) => text.split(",").map((s) => s.trim()).filter(Boolean);

/** The rows of a group that show, each with its control. */
export function shownRows(group: SchemaGroup, values: Record<string, unknown>, defaults: Record<string, unknown>): { row: SchemaRow; control: Control }[] {
  return group.rows.filter((r) => visible(r, values, defaults)).map((row) => ({ row, control: controlOf(row) }));
}

/** The key a `keys` row gives one part, from its value. */
export const keyOf = (value: unknown, part: string): string => (isObject(value) && typeof value[part] === "string" ? value[part] : "");

/** The wheel's states, from wheel.rs: `stopped` is an exit Pomelo chose, `failed` a start it refused; neither restarts. */
export type WheelPhase = "off" | "starting" | "ready" | "conflict" | "crashed" | "missing" | "stopped" | "failed";
export interface WheelState {
  phase: WheelPhase;
  /** A job was refused for the licence. */
  locked: boolean;
  /** The free files left when it was refused. */
  left?: number | null;
  /** The other Pomelo of a conflict: from the Store, a copy started from a folder, or another hosted wheel on the same data. */
  with?: "store" | "copy" | "hosted" | null;
}

/** The phases after which the page offers Try again. */
export const RETRY_PHASES: readonly WheelPhase[] = ["conflict", "crashed", "missing", "stopped", "failed"];

/** What the package lets the page offer: the wheel, an update (a package without it), or a download. */
export function packageNeed(s: { version: string | null; wheel: boolean; outdated: boolean }): "ready" | "update" | "download" {
  if (s.version && s.wheel) return "ready";
  return s.version || s.outdated ? "update" : "download";
}
