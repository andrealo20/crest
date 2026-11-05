import { demo } from "./showcase-data";

/*
 * The demo keeps its "saved" settings and notes in memory: a reload starts fresh, and nothing is left in the
 * visitor's browser or mixed up with the host page's own storage. Imported first in main.tsx, before any store
 * reads it. The seeds below are what the tools show on a fresh start (relative to now).
 */
if (demo) {
  const min = 60_000;
  const now = Date.now();
  const at = (days: number, h: number, m = 0) => {
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return d.getTime() + days * 86_400_000;
  };
  const task = (i: number, text: string, extra: Record<string, unknown> = {}) => ({
    id: `demo-${i}`, projectId: "personal", text, done: false, starred: false, color: null, due: null, alertAt: null, createdAt: now - i * 5 * min, doneAt: null, ...extra,
  });
  const file = (name: string, kind: string, size: number, ago: number) => {
    const ext = name.split(".").pop() ?? "";
    return { path: `C:\\Users\\demo\\Documents\\${name}`, name, kind, ext, size, addedAt: now - ago * min };
  };
  const seeds: Record<string, unknown> = {
    "notch:shelf": [
      file("hero-banner.png", "image", 3_204_000, 2),
      file("Q3-Report.pdf", "document", 1_840_000, 9),
      { type: "text", id: "text-demo", text: "Ship the demo, then write the post.", addedAt: now - 14 * min },
      file("Budget-2027.xlsx", "table", 96_000, 30),
      file("voice-memo.m4a", "audio", 1_010_000, 55),
    ],
    "notch:note": "Launch checklist\n\n- Check the closed row on a small screen\n- Record the demo video\n- Reply to the beta testers\n\nIdea: a pet that sleeps while the timer runs.",
    "notch:scratchpad": {
      lang: "typescript",
      texts: {
        typescript: "// A spring for the notch, in a few lines.\nconst open = spring({ stiffness: 420, damping: 30 });\n\nfunction clamp(v: number, lo: number, hi: number) {\n  return Math.min(hi, Math.max(lo, v));\n}\n",
        python: "def fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\n",
      },
    },
    "notch:todo-projects": {
      projects: [{ id: "personal", name: "Personal" }, { id: "work", name: "Launch" }],
      active: "personal",
      tasks: [
        task(1, "Reply to Sam about lunch", { starred: true, color: "orange" }),
        task(2, "Book the dentist", { due: at(1, 9), alertAt: at(1, 9) }),
        task(3, "Buy coffee beans"),
        task(4, "Renew the domain", { color: "red", due: at(2, 12), alertAt: at(2, 12) }),
        task(5, "Water the plants", { done: true, doneAt: now - 40 * min }),
        task(6, "Write the release notes", { projectId: "work", starred: true }),
        task(7, "Record the demo video", { projectId: "work", color: "blue" }),
        task(8, "Fix the closed row on small screens", { projectId: "work", done: true, doneAt: now - 90 * min }),
      ],
    },
    "notch:water": { log: [{ at: at(0, 8, 10), ml: 500, prev: null }, { at: at(0, 10, 40), ml: 500, prev: at(0, 8, 10) }, { at: now - 30 * min, ml: 300, prev: at(0, 10, 40) }].filter((d) => d.at <= now), lastAt: now - 30 * min },
  };

  const mem = new Map<string, string>(Object.entries(seeds).map(([k, v]) => [k, JSON.stringify(v)]));
  const storage = {
    get length() {
      return mem.size;
    },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  };
  try {
    Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
  } catch {
    // A browser that refuses it keeps the real storage; the demo still runs.
  }
}
