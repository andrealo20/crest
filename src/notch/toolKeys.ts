import { arrowStep } from "../ui/radioKeys.ts";

/** What a key press says about itself, as a KeyboardEvent has it. */
export type ArrowKey = { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; defaultPrevented: boolean };

/**
 * Which way Left/Right switch tools in the open notch, or 0 when the key is not for that (#99). Plain arrows only where nothing
 * else takes them: not in a text field, not already handled (a slider, a switch). Alt+arrows always, a field's cursor ignores
 * them; on a Mac Option+arrows move that cursor by word, so there the pair is Cmd+Option, as Chrome switches tabs.
 */
export function toolArrow(e: ArrowKey, inField: boolean, mac: boolean, rtl: boolean): -1 | 0 | 1 {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return 0;
  const plain = !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
  const pair = e.altKey && !e.ctrlKey && !e.shiftKey && e.metaKey === mac;
  if (plain ? inField || e.defaultPrevented : !pair) return 0;
  return arrowStep(e.key, rtl);
}

/** The tool a step opens: the next or the previous, round past the ends; from a page not on the tool bar, the first or the last. */
export function stepTool(ids: readonly string[], current: string, step: -1 | 1): string | null {
  if (!ids.length) return null;
  const at = ids.indexOf(current);
  if (at < 0) return step > 0 ? ids[0] : ids[ids.length - 1];
  return ids[(at + step + ids.length) % ids.length];
}
