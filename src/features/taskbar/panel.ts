import { createStore } from "../../lib/store";

/*
 * A stand-in for the panel above the bar, with the names of phase 3's panel.ts, which takes this file's place at the merge.
 * Nothing draws it yet: a widget's click only sets the store.
 */

/** What the panel shows: the app menu, or a tool by the id the notch opens it with. */
export type PanelContent = { kind: "apps" } | { kind: "tool"; tool: string };
/** The item the panel opens over: its left edge and its width, CSS px. */
export interface PanelAnchor {
  x: number;
  w: number;
}

/** The open panel, null while it is closed. */
export const panel = createStore<{ content: PanelContent; anchor: PanelAnchor } | null>(null);

// The kind counts too, so no tool id passes for the app menu.
const key = (c: PanelContent) => (c.kind === "tool" ? `tool:${c.tool}` : c.kind);

export function openPanel(content: PanelContent, anchor: PanelAnchor): void {
  panel.set({ content, anchor });
}

/** The same content open closes it; other content takes its place. */
export function togglePanel(content: PanelContent, anchor: PanelAnchor): void {
  const open = panel.get();
  if (open && key(open.content) === key(content)) closePanel();
  else openPanel(content, anchor);
}

export function closePanel(): void {
  panel.set(null);
}
