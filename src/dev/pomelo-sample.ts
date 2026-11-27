/*
 * The made-up Pomelo wheel in the browser (npm run dev): a wheel that starts and listens, and a small settings schema, so the
 * Pomelo scope of the settings can be designed without the app. Nothing runs; values live in memory.
 */
import type { WheelState } from "../features/pomelo/model";

let current: WheelState = { phase: "off", locked: false };
const listeners = new Set<(s: WheelState) => void>();
const tell = (s: WheelState) => {
  current = s;
  listeners.forEach((l) => l(s));
};

export const state = async () => current;

export function onState(handler: (s: WheelState) => void) {
  listeners.add(handler);
  return () => void listeners.delete(handler);
}

export async function set(on: boolean) {
  if (!on) return tell({ phase: "off", locked: false });
  if (current.phase === "starting" || current.phase === "ready") return;
  tell({ phase: "starting", locked: false });
  setTimeout(() => current.phase === "starting" && tell({ phase: "ready", locked: false }), 700);
}

const values: Record<string, unknown> = { "wheel.size": 260, "wheel.glass": true, "wheel.modifier": "shift", keys: { convert: "Shift", tools: "Ctrl", actions: "Alt" } };
const KEYS = ["Shift", "Ctrl", "Alt"];

const SCHEMA = {
  pages: [
    {
      id: "wheel",
      title: "Wheel",
      icon: "wheel",
      groups: [
        {
          title: "Wheel",
          rows: [
            { key: "wheel.size", type: "int", label: "Size", hint: "Of the wheel around the pointer", default: 240, min: 160, max: 400, step: 10 },
            { key: "wheel.modifier", type: "choice", label: "Opens with", default: "shift", choices: [{ id: "shift", label: "Shift" }, { id: "ctrl", label: "Ctrl" }, { id: "alt", label: "Alt" }] },
            { key: "wheel.glass", type: "bool", label: "Glass", hint: "The wheel shows what is behind it", default: true },
            { key: "wheel.glassTint", type: "choice", label: "Tint", default: "auto", visibleIf: { key: "wheel.modifier", equals: ["shift", "ctrl"] }, choices: [{ id: "auto", label: "Automatic" }, { id: "light", label: "Light" }, { id: "dark", label: "Dark" }, { id: "accent", label: "Accent colour" }] },
            {
              key: "keys",
              type: "keys",
              label: "Keys",
              hint: "Tap the key during a drag to open that tab. Each tab has its own key.",
              default: { convert: "Shift", tools: "Ctrl", actions: "Alt" },
              choices: KEYS.map((k) => ({ id: k, label: k })),
              parts: [{ id: "convert", label: "Convert" }, { id: "tools", label: "Tools" }, { id: "actions", label: "Actions" }],
            },
            { key: "wedges", type: "custom", label: "Wedge layout", hint: "Pick the wedges and their order", action: "open-settings", page: "wedges" },
          ],
        },
      ],
    },
    {
      id: "files",
      title: "Files",
      icon: "files",
      groups: [
        {
          title: "Copies",
          rows: [
            { key: "files.suffix", type: "text", label: "Name of the copies", hint: "Added after the original name", default: " (Pomelo)" },
            { key: "files.limit", type: "int", label: "Largest file, MB", default: 4096, min: 1, max: 65536 },
            { key: "files.skip", type: "list", label: "Never touch", hint: "Extensions, separated by commas", default: [".tmp", ".part"] },
            { key: "files.shortcut", type: "keys", label: "Repeat the last job", default: "Ctrl+Shift+R" },
          ],
        },
      ],
    },
  ],
};

export async function settings(action: "schema" | "get" | "set", args: { key?: string; value?: unknown }): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 150));
  if (action === "schema") return SCHEMA;
  if (action === "get") return { ...values };
  if (args.key === "files.suffix" && typeof args.value === "string" && /[\\/:*?"<>|]/.test(args.value))
    return { ok: false, error: "invalid", message: "A file name cannot contain \\ / : * ? \" < > |" };
  if (args.key === "keys") {
    // As Pomelo does: the key given to a tab leaves the tab that had it, which takes this tab's old key.
    const keys = { ...(values.keys as Record<string, string>) };
    for (const [tab, key] of Object.entries(args.value as Record<string, string>)) {
      const holder = Object.keys(keys).find((t) => keys[t] === key);
      if (holder) keys[holder] = keys[tab];
      keys[tab] = key;
    }
    values.keys = keys;
    return { ok: true };
  }
  values[args.key!] = args.value;
  return { ok: true };
}
